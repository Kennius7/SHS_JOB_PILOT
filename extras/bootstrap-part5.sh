#!/usr/bin/env bash
# SHS Job Pilot — Part 4b: scheduler fix, admin endpoints, web app, scripts, README
set -euo pipefail

echo "→ Part 4b: fixing scheduler, adding admin endpoints, web app, docs"

# ============================================================
# Fix: replace SchedulerService with a version that actually fans out
# ============================================================

cat > apps/worker/src/scheduler/scheduler.service.ts <<'EOF'
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '@shs/data';
import { QUEUES } from '../worker.module';

@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue(QUEUES.adzunaSync) private adzunaQueue: Queue,
    @InjectQueue(QUEUES.matchRecent) private matchQueue: Queue,
  ) {}

  async onModuleInit() {
    await this.adzunaQueue.add(
      'sync',
      {},
      {
        repeat: { pattern: '0 */6 * * *' },
        jobId: 'adzuna-sync-cron',
        removeOnComplete: 20,
        removeOnFail: 50,
      },
    );
    this.logger.log('Scheduled recurring jobs');
  }

  /** Enqueue one match-recent job per active user. */
  async fanOutMatchRecent(since: Date): Promise<number> {
    const users = await this.prisma.user.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true },
    });

    let enqueued = 0;
    for (const user of users) {
      await this.matchQueue.add(
        'user',
        { userId: user.id, since: since.toISOString() },
        {
          jobId: `match-${user.id}-${since.getTime()}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: 100,
          removeOnFail: 200,
        },
      );
      enqueued++;
    }
    this.logger.log(`Fan-out: enqueued match-recent for ${enqueued} users`);
    return enqueued;
  }
}
EOF

# ============================================================
# Admin / test endpoints (non-production only)
# ============================================================

cat > apps/api/src/modules/admin/admin.controller.ts <<'EOF'
import {
  Controller, Post, Body, Req, UseGuards, ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiExcludeController } from '@nestjs/swagger';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import { PrismaService } from '@shs/data';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

/**
 * Test-only endpoints. The controller is excluded from Swagger and returns
 * 404 unless NODE_ENV !== 'production'. These exist so the e2e smoke script
 * can drive the pipeline without live provider APIs.
 */
@ApiExcludeController()
@ApiTags('admin-test')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller({ path: 'admin/test', version: '1' })
export class AdminTestController {
  constructor(
    private prisma: PrismaService,
    @InjectQueue('match-recent') private matchQueue: Queue,
  ) {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Test endpoints disabled in production');
    }
  }

  @Post('seed-job')
  async seedJob(@Req() req: any, @Body() body: any) {
    const canonicalKey = createHash('sha256')
      .update(`${body.employer}|${body.title}|${body.city ?? ''}`.toLowerCase())
      .digest('hex')
      .slice(0, 32);

    return this.prisma.job.upsert({
      where: { canonicalKey },
      create: {
        providerKey: body.providerKey ?? 'mock-submission',
        externalId: body.externalId ?? canonicalKey,
        title: body.title,
        employer: body.employer,
        description: body.description ?? 'Seeded test job',
        country: body.country ?? 'NG',
        state: body.state ?? 'LAGOS',
        city: body.city,
        workArrangement: body.workArrangement ?? 'HYBRID',
        employmentType: body.employmentType ?? 'FULL_TIME',
        salaryMin: body.salaryMin,
        salaryMax: body.salaryMax,
        salaryCurrency: body.salaryCurrency ?? 'NGN',
        requiredSkills: body.requiredSkills ?? [],
        preferredSkills: body.preferredSkills ?? [],
        sourceUrl: body.sourceUrl ?? 'https://example.test/job',
        applyUrl: body.applyUrl,
        canonicalKey,
        discoveredBy: 'admin-test-seed',
      },
      update: { lastSeenAt: new Date() },
    });
  }

  @Post('trigger-match-recent')
  async triggerMatchRecent(@Req() req: any, @Body() body: { userId?: string }) {
    const userId = body.userId ?? req.user.userId;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await this.matchQueue.add(
      'manual',
      { userId, since: since.toISOString() },
      { jobId: `manual-${userId}-${Date.now()}` },
    );
    return { enqueued: true, userId };
  }

  @Post('reset-mock-provider')
  async resetMockProvider() {
    // The mock provider is a singleton per worker process; this endpoint
    // just signals intent. To actually reset, restart the worker or
    // add a dedicated control queue. For now, this is a no-op for
    // situations that don't need deterministic state.
    return { reset: true, note: 'Restart the worker to fully reset mock state' };
  }
}
EOF

cat > apps/api/src/modules/admin/admin.module.ts <<'EOF'
import { Module } from '@nestjs/common';
import { AdminTestController } from './admin.controller';

@Module({
  controllers: [AdminTestController],
})
export class AdminModule {}
EOF

# Register AdminModule only in non-production
cat > apps/api/src/app.module.ts <<'EOF'
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { DataModule } from '@shs/data';
import { AuthModule } from './modules/auth/auth.module';
import { ProfileModule } from './modules/profile/profile.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { RulesModule } from './modules/rules/rules.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { AdminModule } from './modules/admin/admin.module';
import { HealthController } from './health.controller';

const isProd = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'] }),
    BullModule.forRoot({
      connection: {
        url: process.env.REDIS_URL ?? 'redis://localhost:6379',
        maxRetriesPerRequest: null,
      },
    }),
    BullModule.registerQueue(
      { name: 'match-recent' },
      { name: 'prepare-application' },
      { name: 'application-submission' },
      { name: 'application-verification' },
    ),
    DataModule,
    AuthModule,
    ProfileModule,
    DocumentsModule,
    RulesModule,
    ApplicationsModule,
    ...(isProd ? [] : [AdminModule]),
  ],
  controllers: [HealthController],
})
export class AppModule {}
EOF

# ============================================================
# apps/web
# ============================================================

cat > apps/web/package.json <<'EOF'
{
  "name": "@shs/web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 3000",
    "lint": "next lint",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@hookform/resolvers": "^3.9.1",
    "@tanstack/react-query": "^5.62.7",
    "lucide-react": "^0.468.0",
    "next": "^15.1.3",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-hook-form": "^7.54.2",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "@types/react": "^19.0.2",
    "@types/react-dom": "^19.0.2",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.17",
    "typescript": "^5.7.2"
  }
}
EOF

cat > apps/web/tsconfig.json <<'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
EOF

cat > apps/web/next.config.ts <<'EOF'
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_INTERNAL_URL ?? 'http://localhost:3001'}/api/:path*`,
      },
    ];
  },
};

export default config;
EOF

cat > apps/web/next-env.d.ts <<'EOF'
/// <reference types="next" />
/// <reference types="next/image-types/global" />
EOF

cat > apps/web/postcss.config.js <<'EOF'
module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };
EOF

cat > apps/web/tailwind.config.ts <<'EOF'
import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef7ff', 100: '#d9edff', 500: '#0a84ff',
          600: '#0066cc', 700: '#0052a3', 900: '#001f3d',
        },
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
} satisfies Config;
EOF

cat > apps/web/.env.local.example <<'EOF'
NEXT_PUBLIC_API_URL=/api
API_INTERNAL_URL=http://localhost:3001
EOF

cat > apps/web/src/app/globals.css <<'EOF'
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  html { @apply antialiased; }
  body { @apply bg-slate-50 text-slate-900; }
}

@layer components {
  .btn {
    @apply inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed;
  }
  .btn-primary { @apply btn bg-brand-600 text-white hover:bg-brand-700; }
  .btn-secondary { @apply btn bg-white border border-slate-200 text-slate-700 hover:bg-slate-50; }
  .btn-danger { @apply btn bg-red-600 text-white hover:bg-red-700; }
  .input {
    @apply w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm
           focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent;
  }
  .card { @apply rounded-xl border border-slate-200 bg-white p-6 shadow-sm; }
  .label { @apply block text-sm font-medium text-slate-700 mb-1; }
}
EOF

cat > apps/web/src/lib/api.ts <<'EOF'
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

let accessToken: string | null = null;
export function setAccessToken(token: string | null) { accessToken = token; }
export function getAccessToken() { return accessToken; }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  const res = await fetch(`${API_BASE}${path}`, {
    ...init, headers, credentials: 'include',
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, body.code ?? 'UNKNOWN', body.message ?? `Request failed (${res.status})`);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, formData: FormData) =>
    request<T>(path, { method: 'POST', body: formData }),
};
EOF

cat > apps/web/src/lib/constants.ts <<'EOF'
export const NIGERIAN_STATES = [
  'ABIA','ADAMAWA','AKWA_IBOM','ANAMBRA','BAUCHI','BAYELSA','BENUE','BORNO',
  'CROSS_RIVER','DELTA','EBONYI','EDO','EKITI','ENUGU','FCT','GOMBE','IMO',
  'JIGAWA','KADUNA','KANO','KATSINA','KEBBI','KOGI','KWARA','LAGOS','NASARAWA',
  'NIGER','OGUN','ONDO','OSUN','OYO','PLATEAU','RIVERS','SOKOTO','TARABA',
  'YOBE','ZAMFARA',
];
EOF

cat > apps/web/src/lib/auth-context.tsx <<'EOF'
'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, setAccessToken } from './api';

export interface AuthUser { id: string; email: string; role: 'USER' | 'ADMIN' }

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const USER_STORAGE_KEY = 'shs.user';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem(USER_STORAGE_KEY) : null;
    if (stored) setUser(JSON.parse(stored));

    (async () => {
      try {
        const res = await api.post<{ accessToken: string }>('/v1/auth/refresh', {});
        setAccessToken(res.accessToken);
      } catch {
        // No valid refresh; user stays logged out.
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function login(email: string, password: string) {
    const res = await api.post<{ accessToken: string; user: AuthUser }>(
      '/v1/auth/login', { email, password },
    );
    setAccessToken(res.accessToken);
    setUser(res.user);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(res.user));
  }

  async function register(email: string, password: string) {
    await api.post('/v1/auth/register', { email, password });
    await login(email, password);
  }

  async function logout() {
    await api.post('/v1/auth/logout', {}).catch(() => {});
    setAccessToken(null);
    setUser(null);
    localStorage.removeItem(USER_STORAGE_KEY);
    router.push('/login');
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
EOF

cat > apps/web/src/lib/onboarding-context.tsx <<'EOF'
'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export const STEPS = ['welcome', 'review-cv', 'contact', 'career', 'skills', 'preferences', 'rules', 'done'] as const;
export type Step = (typeof STEPS)[number];

interface Ctx {
  step: Step;
  stepIndex: number;
  goTo: (s: Step) => void;
  next: () => void;
  back: () => void;
  profile: any;
  isLoading: boolean;
  saveStep: <T>(patch: T, endpoint?: string) => Promise<void>;
}

const OnboardingCtx = createContext<Ctx | null>(null);

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const { data: profile, isLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get<any>('/v1/profile'),
  });
  const [step, setStep] = useState<Step>('welcome');

  useEffect(() => {
    if (profile?.onboardingStep && STEPS.includes(profile.onboardingStep)) {
      setStep(profile.onboardingStep);
    }
  }, [profile?.onboardingStep]);

  const persist = useMutation({
    mutationFn: (s: Step) => api.post('/v1/profile/onboarding-step', { step: s }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profile'] }),
  });

  function goTo(s: Step) { setStep(s); persist.mutate(s); }
  function next() { const i = STEPS.indexOf(step); if (i < STEPS.length - 1) goTo(STEPS[i + 1]); }
  function back() { const i = STEPS.indexOf(step); if (i > 0) goTo(STEPS[i - 1]); }

  async function saveStep<T>(patch: T, endpoint = '/v1/profile') {
    if (endpoint === '/v1/profile') await api.patch(endpoint, patch);
    else await api.post(endpoint, patch);
    await qc.invalidateQueries({ queryKey: ['profile'] });
  }

  return (
    <OnboardingCtx.Provider value={{ step, stepIndex: STEPS.indexOf(step), goTo, next, back, profile, isLoading, saveStep }}>
      {children}
    </OnboardingCtx.Provider>
  );
}

export function useOnboarding() {
  const v = useContext(OnboardingCtx);
  if (!v) throw new Error('useOnboarding must be inside OnboardingProvider');
  return v;
}
EOF

# ---------- App shell ----------

cat > apps/web/src/app/layout.tsx <<'EOF'
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'SHS Job Pilot',
  description: 'Automated job discovery and application platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
EOF

cat > apps/web/src/app/providers.tsx <<'EOF'
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { AuthProvider } from '@/lib/auth-context';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () => new QueryClient({
      defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
    }),
  );
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}
EOF

cat > apps/web/src/app/page.tsx <<'EOF'
import Link from 'next/link';
import { Briefcase, Bot, FileCheck, Shield } from 'lucide-react';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-slate-50">
      <header className="mx-auto flex max-w-6xl items-center justify-between p-6">
        <div className="flex items-center gap-2">
          <Briefcase className="h-6 w-6 text-brand-600" />
          <span className="text-lg font-semibold">SHS Job Pilot</span>
        </div>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/login" className="text-slate-600 hover:text-slate-900">Sign in</Link>
          <Link href="/register" className="btn-primary">Get started</Link>
        </nav>
      </header>

      <section className="mx-auto max-w-4xl px-6 py-20 text-center">
        <h1 className="text-5xl font-bold tracking-tight text-slate-900">
          Find, match, and apply to jobs — automatically.
        </h1>
        <p className="mt-6 text-lg text-slate-600">
          SHS Job Pilot aggregates jobs from across Nigeria and beyond, scores each
          against your career profile, and applies to the ones that fit — with your
          rules, your consent, and full transparency.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/register" className="btn-primary px-6 py-3 text-base">Create account</Link>
          <Link href="/login" className="btn-secondary px-6 py-3 text-base">Sign in</Link>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-6 pb-24 md:grid-cols-4">
        {[
          { icon: Briefcase, title: 'Aggregated discovery', body: 'Jobs from Adzuna, plus manual tracking for LinkedIn, Indeed, and Jobberman.' },
          { icon: Bot, title: 'AI matching', body: 'Gemini scores each job against your profile — never fabricating qualifications.' },
          { icon: FileCheck, title: 'Applications on autopilot', body: 'Cover letters and application materials prepared from your real experience.' },
          { icon: Shield, title: 'You stay in control', body: 'Deterministic rules, approval queues, and a big pause button.' },
        ].map(({ icon: Icon, title, body }) => (
          <div key={title} className="card">
            <Icon className="h-6 w-6 text-brand-600" />
            <h3 className="mt-3 font-semibold">{title}</h3>
            <p className="mt-2 text-sm text-slate-600">{body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
EOF

# ---------- Auth pages ----------

cat > apps/web/src/app/login/page.tsx <<'EOF'
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Briefcase } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api';

const schema = z.object({ email: z.string().email(), password: z.string().min(8) });
type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    setError(null);
    try {
      await login(values.email, values.password);
      router.push('/dashboard');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Sign-in failed');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2">
          <Briefcase className="h-6 w-6 text-brand-600" />
          <span className="text-lg font-semibold">SHS Job Pilot</span>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="card space-y-4">
          <h1 className="text-xl font-semibold">Sign in</h1>
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="email" {...register('email')} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input id="password" type="password" autoComplete="current-password" {...register('password')} className="input" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={formState.isSubmitting} className="btn-primary w-full">
            {formState.isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="text-center text-sm text-slate-600">
            No account? <Link href="/register" className="text-brand-600 hover:underline">Create one</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
EOF

cat > apps/web/src/app/register/page.tsx <<'EOF'
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Briefcase } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'At least 8 characters'),
  confirm: z.string(),
}).refine((d) => d.password === d.confirm, { message: 'Passwords do not match', path: ['confirm'] });
type FormValues = z.infer<typeof schema>;

export default function RegisterPage() {
  const router = useRouter();
  const { register: doRegister } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    setError(null);
    try {
      await doRegister(values.email, values.password);
      router.push('/onboarding');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Registration failed');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2">
          <Briefcase className="h-6 w-6 text-brand-600" />
          <span className="text-lg font-semibold">SHS Job Pilot</span>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="card space-y-4">
          <h1 className="text-xl font-semibold">Create your account</h1>
          <div>
            <label className="label">Email</label>
            <input type="email" autoComplete="email" {...register('email')} className="input" />
          </div>
          <div>
            <label className="label">Password</label>
            <input type="password" autoComplete="new-password" {...register('password')} className="input" />
            {formState.errors.password && <p className="mt-1 text-xs text-red-600">{formState.errors.password.message}</p>}
          </div>
          <div>
            <label className="label">Confirm password</label>
            <input type="password" autoComplete="new-password" {...register('confirm')} className="input" />
            {formState.errors.confirm && <p className="mt-1 text-xs text-red-600">{formState.errors.confirm.message}</p>}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={formState.isSubmitting} className="btn-primary w-full">
            {formState.isSubmitting ? 'Creating account…' : 'Create account'}
          </button>
          <p className="text-center text-sm text-slate-600">
            Already have an account? <Link href="/login" className="text-brand-600 hover:underline">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
EOF

# ---------- Authenticated app layout ----------

cat > apps/web/src/app/\(app\)/layout.tsx <<'EOF'
'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard, Briefcase, FileText, ListChecks, Settings, Shield, LogOut, Bell,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/jobs', label: 'Jobs', icon: Briefcase },
  { href: '/applications', label: 'Applications', icon: ListChecks },
  { href: '/documents', label: 'Documents', icon: FileText },
  { href: '/rules', label: 'Rules', icon: Shield },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isOnboarding = pathname?.startsWith('/onboarding') ?? false;

  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get<any>('/v1/profile'),
    enabled: !!user && !isOnboarding,
  });

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  useEffect(() => {
    if (!user || !profile || isOnboarding) return;
    const onboardingDone = !!profile.onboardingCompletedAt;
    if (!onboardingDone) router.replace('/onboarding');
  }, [user, profile, isOnboarding, router]);

  if (loading || !user) {
    return <div className="flex min-h-screen items-center justify-center text-slate-500">Loading…</div>;
  }

  if (isOnboarding) {
    return <div className="min-h-screen bg-slate-50">{children}</div>;
  }

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white md:flex md:flex-col">
        <div className="flex h-16 items-center gap-2 border-b border-slate-200 px-6">
          <Briefcase className="h-5 w-5 text-brand-600" />
          <span className="font-semibold">Job Pilot</span>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname?.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                  active ? 'bg-brand-50 text-brand-700 font-medium' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-slate-200 p-3">
          <div className="mb-2 truncate px-3 text-xs text-slate-500">{user.email}</div>
          <button onClick={logout} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex-1">
        <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-6">
          <h1 className="text-lg font-semibold capitalize">
            {pathname?.split('/')[1] ?? 'Dashboard'}
          </h1>
          <Link href="/notifications" className="relative rounded-lg p-2 hover:bg-slate-100">
            <Bell className="h-5 w-5 text-slate-600" />
          </Link>
        </header>
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
EOF

# ---------- Dashboard ----------

cat > apps/web/src/app/\(app\)/dashboard/page.tsx <<'EOF'
'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Briefcase, ListChecks, CheckCircle2, AlertCircle, FileText } from 'lucide-react';
import { api } from '@/lib/api';

interface Summary {
  discoveredJobs: number;
  newMatches: number;
  awaitingApproval: number;
  submitted: number;
  confirmed: number;
  failed: number;
  needsInput: number;
}

export default function DashboardPage() {
  const { data: apps } = useQuery({
    queryKey: ['applications', 'summary'],
    queryFn: () => api.get<any[]>('/v1/applications'),
  });

  const counts = (apps ?? []).reduce((acc: any, a: any) => {
    acc[a.state] = (acc[a.state] ?? 0) + 1;
    return acc;
  }, {});

  const cards = [
    { key: 'MATCHED', label: 'Matched', icon: Briefcase, tone: 'text-brand-600' },
    { key: 'AWAITING_APPROVAL', label: 'Awaiting approval', icon: AlertCircle, tone: 'text-amber-600' },
    { key: 'SUBMITTED', label: 'Submitted', icon: ListChecks, tone: 'text-slate-600' },
    { key: 'CONFIRMED', label: 'Confirmed', icon: CheckCircle2, tone: 'text-green-600' },
    { key: 'FAILED', label: 'Failed', icon: AlertCircle, tone: 'text-red-600' },
    { key: 'DISCOVERED', label: 'Discovered', icon: FileText, tone: 'text-slate-600' },
  ] as const;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        <Link href="/jobs" className="btn-primary">Browse jobs</Link>
        <Link href="/rules" className="btn-secondary">Edit rules</Link>
        <Link href="/documents" className="btn-secondary">Upload CV</Link>
      </div>

      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        {cards.map(({ key, label, icon: Icon, tone }) => (
          <div key={key} className="card">
            <Icon className={`h-5 w-5 ${tone}`} />
            <div className="mt-2 text-2xl font-semibold">{counts[key] ?? 0}</div>
            <div className="text-xs text-slate-500">{label}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold">Getting started</h2>
        <ol className="mt-3 space-y-2 text-sm text-slate-600">
          <li>1. Upload your CV and confirm the parsed profile.</li>
          <li>2. Set target roles, states, and salary preferences.</li>
          <li>3. Define application rules and simulate against existing jobs.</li>
          <li>4. Enable approval-required mode before automatic submission.</li>
        </ol>
      </div>
    </div>
  );
}
EOF

# ---------- Documents page ----------

cat > apps/web/src/app/\(app\)/documents/page.tsx <<'EOF'
'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, Trash2, FileText } from 'lucide-react';
import { api, ApiError, getAccessToken } from '@/lib/api';

interface Doc {
  id: string;
  kind: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  extractionStatus: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'NEEDS_OCR';
  createdAt: string;
}

export default function DocumentsPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: docs, isLoading } = useQuery({
    queryKey: ['documents'],
    queryFn: () => api.get<Doc[]>('/v1/documents'),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.upload<Doc>('/v1/documents', fd);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['documents'] }); setError(null); },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Upload failed'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/v1/documents/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents'] }),
  });

  async function download(id: string, filename: string) {
    const res = await fetch(`/api/v1/documents/${id}/download`, {
      headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
      credentials: 'include',
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function statusBadge(status: Doc['extractionStatus']) {
    const map = {
      PENDING: 'bg-slate-100 text-slate-600',
      PROCESSING: 'bg-blue-100 text-blue-700',
      SUCCESS: 'bg-green-100 text-green-700',
      FAILED: 'bg-red-100 text-red-700',
      NEEDS_OCR: 'bg-amber-100 text-amber-700',
    } as const;
    return <span className={`rounded px-2 py-0.5 text-xs ${map[status]}`}>{status}</span>;
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Documents</h2>
            <p className="text-sm text-slate-600">Upload your CV (PDF or DOCX). Max 10 MB.</p>
          </div>
          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.doc,.docx,application/pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate(file);
                e.target.value = '';
              }}
            />
            <button className="btn-primary" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
              <Upload className="h-4 w-4" />
              {upload.isPending ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>

      <div className="card p-0">
        {isLoading ? (
          <div className="p-6 text-sm text-slate-500">Loading…</div>
        ) : !docs?.length ? (
          <div className="p-12 text-center text-sm text-slate-500">
            <FileText className="mx-auto mb-3 h-8 w-8 text-slate-300" />
            No documents yet. Upload your CV to get started.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Size</th>
                <th className="px-4 py-3">Extraction</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {docs.map((d) => (
                <tr key={d.id}>
                  <td className="px-4 py-3 font-medium">{d.originalName}</td>
                  <td className="px-4 py-3 text-slate-600">{d.kind}</td>
                  <td className="px-4 py-3 text-slate-600">{Math.round(d.sizeBytes / 1024)} KB</td>
                  <td className="px-4 py-3">{statusBadge(d.extractionStatus)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => download(d.id, d.originalName)}
                      className="mr-2 inline-flex rounded p-2 text-slate-500 hover:bg-slate-100"
                    >
                      ⬇
                    </button>
                    <button onClick={() => remove.mutate(d.id)} className="inline-flex rounded p-2 text-red-500 hover:bg-red-50">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
EOF

# ---------- Jobs page ----------

cat > apps/web/src/app/\(app\)/jobs/page.tsx <<'EOF'
'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, MapPin, Building2 } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface Job {
  id: string; title: string; employer: string; city?: string; state?: string;
  workArrangement: string; employmentType: string;
  salaryMin?: number; salaryMax?: number; salaryCurrency?: string;
  publishedAt?: string; providerKey: string; attribution?: string;
}
interface JobsResponse { items: Job[]; total: number; page: number; pageSize: number }

export default function JobsPage() {
  const [q, setQ] = useState('');
  const [state, setState] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['jobs', q, state, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (q) params.set('q', q);
      if (state) params.set('state', state);
      return api.get<JobsResponse>(`/v1/jobs?${params}`);
    },
  });

  return (
    <div className="space-y-4">
      <div className="card flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder="Search by title, employer, or skill"
            className="input pl-9"
          />
        </div>
        <select value={state} onChange={(e) => { setState(e.target.value); setPage(1); }} className="input md:w-48">
          <option value="">All states</option>
          <option value="LAGOS">Lagos</option>
          <option value="FCT">FCT (Abuja)</option>
          <option value="RIVERS">Rivers</option>
        </select>
      </div>

      {isLoading ? (
        <div className="card text-sm text-slate-500">Loading jobs…</div>
      ) : !data?.items?.length ? (
        <div className="card text-center text-sm text-slate-500">
          No jobs match those filters yet. Try widening your search, or wait for the next provider sync.
        </div>
      ) : (
        <ul className="space-y-3">
          {data.items.map((job) => (
            <li key={job.id} className="card">
              <Link href={`/jobs/${job.id}`} className="block">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold text-slate-900">{job.title}</h3>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-slate-600">
                      <span className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5" />{job.employer}</span>
                      {(job.city || job.state) && (
                        <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{[job.city, job.state].filter(Boolean).join(', ')}</span>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <span className="rounded bg-slate-100 px-2 py-0.5">{job.workArrangement}</span>
                      <span className="rounded bg-slate-100 px-2 py-0.5">{job.employmentType}</span>
                      {job.salaryMin != null && (
                        <span className="rounded bg-green-50 px-2 py-0.5 text-green-700">
                          {job.salaryCurrency ?? 'NGN'} {job.salaryMin.toLocaleString()}
                          {job.salaryMax != null && ` – ${job.salaryMax.toLocaleString()}`}
                        </span>
                      )}
                    </div>
                  </div>
                  {job.attribution && (
                    <span className="shrink-0 rounded bg-brand-50 px-2 py-1 text-xs text-brand-700">
                      {job.attribution}
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
EOF

# ---------- Applications list ----------

cat > apps/web/src/app/\(app\)/applications/page.tsx <<'EOF'
'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { CheckCircle2, AlertCircle, Clock, ExternalLink, ThumbsDown } from 'lucide-react';
import { api } from '@/lib/api';

const TABS = [
  { key: 'AWAITING_APPROVAL', label: 'Awaiting approval' },
  { key: 'QUEUED', label: 'Queued' },
  { key: 'SUBMITTED', label: 'Submitted' },
  { key: 'CONFIRMED', label: 'Confirmed' },
  { key: 'NEEDS_USER_INPUT', label: 'Needs input' },
  { key: 'FAILED', label: 'Failed' },
  { key: 'MANUAL_APPLICATION_REQUIRED', label: 'Manual apply' },
];

export default function ApplicationsPage() {
  const [tab, setTab] = useState('AWAITING_APPROVAL');
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['applications', tab],
    queryFn: () => api.get<any[]>(`/v1/applications?state=${tab}`),
  });

  const approve = useMutation({
    mutationFn: (id: string) => api.post(`/v1/applications/${id}/approve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['applications'] }),
  });
  const skip = useMutation({
    mutationFn: (id: string) => api.post(`/v1/applications/${id}/skip`, { reason: 'user_skipped' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['applications'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${
              tab === t.key ? 'border-brand-500 font-medium text-brand-700' : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="card text-sm text-slate-500">Loading…</div>
      ) : !data?.length ? (
        <div className="card text-center text-sm text-slate-500">
          <Clock className="mx-auto mb-3 h-8 w-8 text-slate-300" />
          No applications in this state.
        </div>
      ) : (
        <ul className="space-y-3">
          {data.map((app) => (
            <li key={app.id} className="card">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Link href={`/applications/${app.id}`} className="font-semibold hover:text-brand-600">
                    {app.job.title}
                  </Link>
                  <p className="text-sm text-slate-600">{app.job.employer}</p>
                  {app.matchScore != null && (
                    <p className="mt-1 text-xs text-slate-500">Match score: {Math.round(app.matchScore)}</p>
                  )}
                  {app.lastError && (
                    <p className="mt-2 flex items-center gap-1 text-xs text-red-600">
                      <AlertCircle className="h-3.5 w-3.5" /> {app.lastError}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  {app.state === 'AWAITING_APPROVAL' && (
                    <>
                      <button onClick={() => approve.mutate(app.id)} className="btn-primary">
                        <CheckCircle2 className="h-4 w-4" /> Approve
                      </button>
                      <button onClick={() => skip.mutate(app.id)} className="btn-secondary">
                        <ThumbsDown className="h-4 w-4" /> Skip
                      </button>
                    </>
                  )}
                  {app.state === 'MANUAL_APPLICATION_REQUIRED' && app.job.applyUrl && (
                    <a href={app.job.applyUrl} target="_blank" rel="noopener noreferrer" className="btn-primary">
                      <ExternalLink className="h-4 w-4" /> Apply on site
                    </a>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
EOF

# ---------- Application detail ----------

cat > apps/web/src/app/\(app\)/applications/\[id\]/page.tsx <<'EOF'
'use client';

import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, AlertCircle, Clock, FileText, ExternalLink, Ban } from 'lucide-react';
import { api } from '@/lib/api';

const STATE_TONES: Record<string, string> = {
  AWAITING_APPROVAL: 'bg-amber-100 text-amber-800',
  QUEUED: 'bg-indigo-100 text-indigo-700',
  SUBMITTING: 'bg-indigo-100 text-indigo-700',
  SUBMITTED: 'bg-green-100 text-green-700',
  CONFIRMED: 'bg-green-100 text-green-800',
  SKIPPED: 'bg-slate-100 text-slate-500',
  NEEDS_USER_INPUT: 'bg-amber-100 text-amber-800',
  MANUAL_APPLICATION_REQUIRED: 'bg-amber-100 text-amber-800',
  FAILED: 'bg-red-100 text-red-700',
  UNKNOWN_OUTCOME: 'bg-amber-100 text-amber-800',
};

export default function ApplicationDetailPage() {
  const params = useParams<{ id: string }>();
  const qc = useQueryClient();

  const { data: app, isLoading } = useQuery({
    queryKey: ['application', params.id],
    queryFn: () => api.get<any>(`/v1/applications/${params.id}`),
    refetchInterval: (q) => (['SUBMITTING', 'QUEUED', 'SUBMITTED'].includes(q.state.data?.state) ? 5000 : false),
  });

  const approve = useMutation({
    mutationFn: () => api.post(`/v1/applications/${params.id}/approve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['application', params.id] }),
  });
  const skip = useMutation({
    mutationFn: () => api.post(`/v1/applications/${params.id}/skip`, { reason: 'user_skipped' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['application', params.id] }),
  });

  if (isLoading) return <div className="card text-sm text-slate-500">Loading…</div>;
  if (!app) return <div className="card text-sm text-slate-500">Not found.</div>;

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">{app.job.title}</h1>
            <p className="text-sm text-slate-600">{app.job.employer}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={`rounded px-2 py-0.5 text-xs ${STATE_TONES[app.state] ?? ''}`}>
                {app.state.replace(/_/g, ' ')}
              </span>
              {app.matchScore != null && (
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">Match {Math.round(app.matchScore)}</span>
              )}
              <span className="text-xs text-slate-500">via {app.job.providerKey}</span>
            </div>
          </div>
          <div className="flex gap-2">
            {app.state === 'AWAITING_APPROVAL' && (
              <>
                <button onClick={() => approve.mutate()} disabled={approve.isPending} className="btn-primary">
                  <CheckCircle2 className="h-4 w-4" /> Approve & queue
                </button>
                <button onClick={() => skip.mutate()} disabled={skip.isPending} className="btn-secondary">
                  <Ban className="h-4 w-4" /> Skip
                </button>
              </>
            )}
            {app.state === 'MANUAL_APPLICATION_REQUIRED' && app.job.applyUrl && (
              <a href={app.job.applyUrl} target="_blank" rel="noopener noreferrer" className="btn-primary">
                <ExternalLink className="h-4 w-4" /> Apply on site
              </a>
            )}
          </div>
        </div>

        {app.lastError && (
          <div className="mt-4 rounded bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="mb-1 inline h-4 w-4" /> {app.lastError}
          </div>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="card">
          <h2 className="font-semibold">Timeline</h2>
          <ul className="mt-3 space-y-3">
            {app.events?.map((e: any) => (
              <li key={e.id} className="flex gap-3 text-sm">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                <div>
                  <div>
                    {e.fromState && <span className="text-slate-500">{e.fromState} → </span>}
                    <span className="font-medium">{e.toState}</span>
                  </div>
                  {e.note && <div className="text-xs text-slate-500">{e.note}</div>}
                  <div className="text-xs text-slate-400">{new Date(e.createdAt).toLocaleString()}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="card">
          <h2 className="font-semibold">Submission attempts</h2>
          {!app.attempts?.length ? (
            <p className="mt-3 text-sm text-slate-500">No submission attempts yet.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {app.attempts.map((a: any) => (
                <li key={a.id} className="rounded border border-slate-200 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Attempt {a.attemptNumber}</span>
                    <span className="text-xs text-slate-500">{a.outcome}</span>
                  </div>
                  {a.errorMessage && <div className="mt-1 text-xs text-red-600">{a.errorMessage}</div>}
                  {a.providerRefId && <div className="mt-1 font-mono text-xs text-slate-500">ref: {a.providerRefId}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {app.materials?.length > 0 && (
        <div className="card">
          <h2 className="font-semibold">Materials</h2>
          {app.materials.map((m: any) => (
            <details key={m.id} className="mt-3">
              <summary className="cursor-pointer text-sm font-medium">
                <FileText className="mr-1 inline h-4 w-4" /> {m.kind.replace(/_/g, ' ')}
              </summary>
              <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-3 text-xs">
                {m.content ?? '(no content)'}
              </pre>
            </details>
          ))}
        </div>
      )}

      <details className="card">
        <summary className="cursor-pointer text-sm font-medium">Rule evaluation</summary>
        <pre className="mt-3 overflow-auto rounded bg-slate-50 p-3 text-xs">
          {JSON.stringify(app.ruleEvalJson, null, 2)}
        </pre>
      </details>
    </div>
  );
}
EOF

# ---------- Rules page ----------

cat > apps/web/src/app/\(app\)/rules/page.tsx <<'EOF'
'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, Save, Plus, Trash2, ShieldAlert, ShieldCheck, Info } from 'lucide-react';
import { api } from '@/lib/api';

const EMPTY = {
  hard: [] as any[],
  soft: { conditions: [] as any[], minPassRatio: 0.5 },
  minMatchScore: 70,
};

export default function RulesPage() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<any>(EMPTY);
  const [name, setName] = useState('My rule set');
  const [simulation, setSimulation] = useState<any>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const { data: active } = useQuery({
    queryKey: ['rules', 'active'],
    queryFn: () => api.get<any>('/v1/rules/active'),
  });

  useEffect(() => {
    if (active?.conditions) {
      setDraft({ ...EMPTY, ...active.conditions });
      setName(active.name ?? 'My rule set');
    }
  }, [active]);

  const save = useMutation({
    mutationFn: () => active?.id
      ? api.patch(`/v1/rules/${active.id}`, { name, conditions: draft })
      : api.post('/v1/rules', { name, conditions: draft }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rules'] }); setSavedAt(new Date()); },
  });

  const simulate = useMutation({
    mutationFn: () => api.post<any>('/v1/rules/simulate', { conditions: draft }),
    onSuccess: (data) => setSimulation(data),
  });

  function addCondition(slot: 'hard' | 'soft') {
    const c = { type: 'STATE_IN', states: ['LAGOS'] };
    if (slot === 'hard') setDraft({ ...draft, hard: [...draft.hard, c] });
    else setDraft({ ...draft, soft: { ...draft.soft, conditions: [...draft.soft.conditions, c] } });
  }

  function removeCondition(slot: 'hard' | 'soft', i: number) {
    if (slot === 'hard') setDraft({ ...draft, hard: draft.hard.filter((_: any, j: number) => j !== i) });
    else setDraft({ ...draft, soft: { ...draft.soft, conditions: draft.soft.conditions.filter((_: any, j: number) => j !== i) } });
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <label className="label">Rule name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input max-w-sm" />
          </div>
          <div className="flex gap-2 pt-6">
            <button onClick={() => simulate.mutate()} disabled={simulate.isPending} className="btn-secondary">
              <Play className="h-4 w-4" /> {simulate.isPending ? 'Simulating…' : 'Simulate'}
            </button>
            <button onClick={() => save.mutate()} disabled={save.isPending} className="btn-primary">
              <Save className="h-4 w-4" /> {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
        {savedAt && <p className="mt-2 text-xs text-green-600">Saved at {savedAt.toLocaleTimeString()}</p>}
      </div>

      <div className="card space-y-3">
        <div className="flex items-start gap-3">
          <ShieldAlert className="h-5 w-5 text-red-500" />
          <div>
            <h2 className="font-semibold">Hard rules</h2>
            <p className="text-sm text-slate-600">A single failure rejects the job outright. AI scores cannot override these.</p>
          </div>
        </div>
        {draft.hard.map((c: any, i: number) => (
          <ConditionRow key={i} condition={c} onChange={(next) => {
            const copy = [...draft.hard]; copy[i] = next; setDraft({ ...draft, hard: copy });
          }} onRemove={() => removeCondition('hard', i)} />
        ))}
        <button onClick={() => addCondition('hard')} className="btn-secondary">
          <Plus className="h-4 w-4" /> Add hard condition
        </button>
      </div>

      <div className="card space-y-3">
        <div className="flex items-start gap-3">
          <ShieldCheck className="h-5 w-5 text-green-500" />
          <div>
            <h2 className="font-semibold">Soft rules</h2>
            <p className="text-sm text-slate-600">Contribute to a pass ratio. Below the ratio → job moves to REVIEW.</p>
          </div>
        </div>
        <div>
          <label className="label">Minimum pass ratio: {(draft.soft.minPassRatio * 100).toFixed(0)}%</label>
          <input
            type="range" min={0} max={1} step={0.05}
            value={draft.soft.minPassRatio}
            onChange={(e) => setDraft({ ...draft, soft: { ...draft.soft, minPassRatio: Number(e.target.value) } })}
            className="w-full max-w-md"
          />
        </div>
        {draft.soft.conditions.map((c: any, i: number) => (
          <ConditionRow key={i} condition={c} onChange={(next) => {
            const copy = [...draft.soft.conditions]; copy[i] = next;
            setDraft({ ...draft, soft: { ...draft.soft, conditions: copy } });
          }} onRemove={() => removeCondition('soft', i)} />
        ))}
        <button onClick={() => addCondition('soft')} className="btn-secondary">
          <Plus className="h-4 w-4" /> Add soft condition
        </button>
      </div>

      <div className="card">
        <label className="label">Minimum AI match score: {draft.minMatchScore}</label>
        <input
          type="range" min={0} max={100}
          value={draft.minMatchScore}
          onChange={(e) => setDraft({ ...draft, minMatchScore: Number(e.target.value) })}
          className="w-full max-w-md"
        />
      </div>

      {simulation && (
        <div className="card space-y-3">
          <div className="flex items-center gap-3">
            <Info className="h-5 w-5 text-brand-600" />
            <h2 className="font-semibold">Simulation results</h2>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Evaluated" value={simulation.evaluated} />
            <Stat label="Eligible" value={simulation.eligible} tone="text-green-600" />
            <Stat label="Review" value={simulation.review} tone="text-amber-600" />
            <Stat label="Ineligible" value={simulation.ineligible} tone="text-red-600" />
          </div>
        </div>
      )}

      <details className="card">
        <summary className="cursor-pointer text-sm font-medium">Raw JSON (advanced)</summary>
        <pre className="mt-3 max-h-96 overflow-auto rounded bg-slate-50 p-3 text-xs">{JSON.stringify(draft, null, 2)}</pre>
      </details>
    </div>
  );
}

function ConditionRow({ condition, onChange, onRemove }: { condition: any; onChange: (c: any) => void; onRemove: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <select
        value={condition.type}
        onChange={(e) => onChange(defaultFor(e.target.value))}
        className="input max-w-xs"
      >
        <option value="STATE_IN">State is one of</option>
        <option value="WORK_ARRANGEMENT_IN">Work arrangement is one of</option>
        <option value="EMPLOYER_NOT_IN">Employer not in list</option>
        <option value="TITLE_MATCHES">Title matches</option>
        <option value="SALARY_MIN_AT_LEAST">Salary at least</option>
        <option value="POSTED_WITHIN_DAYS">Posted within days</option>
        <option value="DESCRIPTION_NOT_CONTAINS">Description not contains</option>
      </select>
      <div className="flex-1">
        {condition.type === 'STATE_IN' && (
          <input
            value={(condition.states ?? []).join(', ')}
            onChange={(e) => onChange({ ...condition, states: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
            placeholder="LAGOS, FCT"
            className="input"
          />
        )}
        {condition.type === 'EMPLOYER_NOT_IN' && (
          <input
            value={(condition.employers ?? []).join(', ')}
            onChange={(e) => onChange({ ...condition, employers: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
            className="input"
          />
        )}
        {condition.type === 'WORK_ARRANGEMENT_IN' && (
          <input
            value={(condition.values ?? []).join(', ')}
            onChange={(e) => onChange({ ...condition, values: e.target.value.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) })}
            placeholder="REMOTE, HYBRID"
            className="input"
          />
        )}
        {condition.type === 'TITLE_MATCHES' && (
          <input
            value={(condition.patterns ?? []).join(', ')}
            onChange={(e) => onChange({ ...condition, patterns: e.target.value.split(',').map((s) => s.trim()).filter(Boolean), mode: 'any', caseSensitive: false })}
            placeholder="engineer, developer"
            className="input"
          />
        )}
        {condition.type === 'SALARY_MIN_AT_LEAST' && (
          <div className="flex gap-2">
            <input
              type="number"
              value={condition.amount ?? 0}
              onChange={(e) => onChange({ ...condition, amount: Number(e.target.value), currency: 'NGN', allowMissing: true })}
              className="input max-w-[160px]"
            />
            <span className="self-center text-xs text-slate-500">NGN / year</span>
          </div>
        )}
        {condition.type === 'POSTED_WITHIN_DAYS' && (
          <input
            type="number"
            value={condition.days ?? 30}
            onChange={(e) => onChange({ ...condition, days: Number(e.target.value) })}
            className="input max-w-[120px]"
          />
        )}
        {condition.type === 'DESCRIPTION_NOT_CONTAINS' && (
          <input
            value={(condition.terms ?? []).join(', ')}
            onChange={(e) => onChange({ ...condition, terms: e.target.value.split(',').map((s) => s.trim()).filter(Boolean), caseSensitive: false })}
            className="input"
          />
        )}
      </div>
      <button onClick={onRemove} className="rounded p-2 text-red-500 hover:bg-red-50">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function Stat({ label, value, tone = 'text-slate-900' }: { label: string; value: number; tone?: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-xl font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

function defaultFor(type: string): any {
  switch (type) {
    case 'STATE_IN': return { type, states: ['LAGOS'] };
    case 'EMPLOYER_NOT_IN': return { type, employers: [] };
    case 'WORK_ARRANGEMENT_IN': return { type, values: ['REMOTE'] };
    case 'TITLE_MATCHES': return { type, patterns: [], mode: 'any', caseSensitive: false };
    case 'SALARY_MIN_AT_LEAST': return { type, amount: 0, currency: 'NGN', allowMissing: true };
    case 'POSTED_WITHIN_DAYS': return { type, days: 30 };
    case 'DESCRIPTION_NOT_CONTAINS': return { type, terms: [], caseSensitive: false };
    default: return { type };
  }
}
EOF

# ---------- Placeholder pages ----------

for route in settings notifications; do
  cat > "apps/web/src/app/(app)/${route}/page.tsx" <<EOF
'use client';
export default function Page() {
  return <div className="card text-sm text-slate-600">Coming soon.</div>;
}
EOF
done

cat > "apps/web/src/app/(app)/jobs/[id]/page.tsx" <<'EOF'
'use client';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: job, isLoading } = useQuery({
    queryKey: ['job', id],
    queryFn: () => api.get<any>(`/v1/jobs/${id}`),
  });
  if (isLoading) return <div className="card text-sm text-slate-500">Loading…</div>;
  if (!job) return <div className="card text-sm text-slate-500">Not found.</div>;
  return (
    <div className="space-y-6">
      <div className="card">
        <h1 className="text-xl font-semibold">{job.title}</h1>
        <p className="text-sm text-slate-600">{job.employer}</p>
        {job.attribution && <p className="mt-2 text-xs text-brand-700">{job.attribution}</p>}
        {job.applyUrl && (
          <a href={job.applyUrl} target="_blank" rel="noopener noreferrer" className="btn-primary mt-4">
            Apply on site
          </a>
        )}
      </div>
      <div className="card">
        <h2 className="font-semibold">Description</h2>
        <pre className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{job.description}</pre>
      </div>
    </div>
  );
}
EOF

# ---------- Onboarding wizard ----------

cat > "apps/web/src/app/(app)/onboarding/layout.tsx" <<'EOF'
'use client';

import { OnboardingProvider, useOnboarding, STEPS } from '@/lib/onboarding-context';
import { Check } from 'lucide-react';

const LABELS: Record<string, string> = {
  welcome: 'Welcome', 'review-cv': 'Review CV', contact: 'Contact',
  career: 'Career', skills: 'Skills', preferences: 'Preferences',
  rules: 'Rules', done: 'Done',
};

function Progress() {
  const { stepIndex } = useOnboarding();
  const visible = STEPS.filter((s) => s !== 'done');
  return (
    <ol className="flex items-center justify-between">
      {visible.map((s, i) => {
        const done = i < stepIndex;
        const active = i === stepIndex;
        return (
          <li key={s} className="flex flex-1 items-center">
            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
              done ? 'bg-brand-600 text-white' : active ? 'bg-brand-100 text-brand-700 ring-2 ring-brand-500' : 'bg-slate-100 text-slate-500'
            }`}>
              {done ? <Check className="h-4 w-4" /> : i + 1}
            </div>
            <span className={`ml-2 hidden text-xs md:inline ${active ? 'font-medium text-slate-900' : 'text-slate-500'}`}>{LABELS[s]}</span>
            {i < visible.length - 1 && <div className={`mx-3 hidden flex-1 border-t md:block ${done ? 'border-brand-500' : 'border-slate-200'}`} />}
          </li>
        );
      })}
    </ol>
  );
}

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <OnboardingProvider>
      <div className="mx-auto max-w-2xl px-4 py-10">
        <Progress />
        <div className="mt-8">{children}</div>
      </div>
    </OnboardingProvider>
  );
}
EOF

cat > "apps/web/src/app/(app)/onboarding/page.tsx" <<'EOF'
'use client';

import { useOnboarding } from '@/lib/onboarding-context';
import { WelcomeStep } from './steps/welcome-step';
import { ReviewCvStep } from './steps/review-cv-step';
import { ContactStep } from './steps/contact-step';
import { CareerStep } from './steps/career-step';
import { SkillsStep } from './steps/skills-step';
import { PreferencesStep } from './steps/preferences-step';
import { RulesStep } from './steps/rules-step';
import { DoneStep } from './steps/done-step';

export default function OnboardingPage() {
  const { step, isLoading } = useOnboarding();
  if (isLoading) return <div className="text-center text-sm text-slate-500">Loading…</div>;
  switch (step) {
    case 'welcome': return <WelcomeStep />;
    case 'review-cv': return <ReviewCvStep />;
    case 'contact': return <ContactStep />;
    case 'career': return <CareerStep />;
    case 'skills': return <SkillsStep />;
    case 'preferences': return <PreferencesStep />;
    case 'rules': return <RulesStep />;
    case 'done': return <DoneStep />;
  }
}
EOF

cat > "apps/web/src/app/(app)/onboarding/steps/welcome-step.tsx" <<'EOF'
'use client';
import { useRef, useState } from 'react';
import { Upload, FileText, SkipForward, Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useOnboarding } from '@/lib/onboarding-context';

export function WelcomeStep() {
  const { next } = useOnboarding();
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'parsing' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File) {
    setError(null); setStatus('uploading');
    try {
      const fd = new FormData(); fd.append('file', file);
      const doc = await api.upload<{ id: string }>('/v1/documents', fd);
      setStatus('parsing');
      await api.post(`/v1/documents/${doc.id}/parse`);
      next();
    } catch (e) {
      setStatus('error');
      setError(e instanceof ApiError ? e.message : 'Something went wrong');
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Welcome to SHS Job Pilot</h1>
        <p className="mt-2 text-sm text-slate-600">
          We'll set up your career profile in under two minutes. Upload your CV and
          we'll pre-fill what we can — you'll review every field before we save it.
        </p>
      </header>
      <div className="card space-y-4">
        <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,application/pdf" className="hidden"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        <button onClick={() => fileRef.current?.click()} disabled={status === 'uploading' || status === 'parsing'}
          className="w-full rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 py-12 hover:border-brand-400 hover:bg-brand-50 disabled:opacity-50">
          {status === 'uploading' || status === 'parsing' ? (
            <>
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-600" />
              <p className="mt-3 text-sm font-medium">{status === 'uploading' ? 'Uploading…' : 'Reading your CV…'}</p>
            </>
          ) : (
            <>
              <Upload className="mx-auto h-8 w-8 text-slate-400" />
              <p className="mt-3 text-sm font-medium">Upload CV (PDF or DOCX)</p>
              <p className="mt-1 text-xs text-slate-500">Max 10 MB</p>
            </>
          )}
        </button>
        {error && <div className="rounded bg-red-50 p-3 text-sm text-red-700"><FileText className="mb-1 inline h-4 w-4" /> {error}</div>}
        <div className="flex items-center justify-between border-t border-slate-200 pt-4">
          <p className="text-xs text-slate-500">No CV handy? You can fill everything in manually.</p>
          <button onClick={next} className="btn-secondary"><SkipForward className="h-4 w-4" /> Skip for now</button>
        </div>
      </div>
    </div>
  );
}
EOF

cat > "apps/web/src/app/(app)/onboarding/steps/review-cv-step.tsx" <<'EOF'
'use client';
import { useEffect, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Check, X, Sparkles, User, Briefcase, GraduationCap } from 'lucide-react';
import { api } from '@/lib/api';
import { useOnboarding } from '@/lib/onboarding-context';

type Section = 'contact' | 'skills' | 'experience' | 'education' | 'summary';

export function ReviewCvStep() {
  const { next, back } = useOnboarding();
  const [accepted, setAccepted] = useState<Set<Section>>(new Set(['contact', 'skills', 'experience', 'education', 'summary']));
  const [edited, setEdited] = useState<any>(null);

  const { data: docs } = useQuery({ queryKey: ['documents'], queryFn: () => api.get<any[]>('/v1/documents') });
  const cvDoc = docs?.find((d) => d.parsedData && d.kind === 'CV');

  useEffect(() => { if (cvDoc?.parsedData && !edited) setEdited(cvDoc.parsedData); }, [cvDoc, edited]);

  const apply = useMutation({
    mutationFn: () => api.post('/v1/profile/apply-parsed', {
      documentId: cvDoc.id,
      acceptedSections: Array.from(accepted),
      profile: edited?.fullName || edited?.phone ? { fullName: edited.fullName, phone: edited.phone } : undefined,
      skills: edited?.skills?.map((name: string) => ({ name })),
      experience: edited?.experience,
      education: edited?.education,
    }),
    onSuccess: () => next(),
  });

  if (!cvDoc || !edited) {
    return (
      <div className="card text-center text-sm text-slate-500">
        No parsed CV found. <button onClick={next} className="text-brand-600 underline">Continue manually</button>.
      </div>
    );
  }

  function toggle(s: Section) {
    setAccepted((p) => { const n = new Set(p); n.has(s) ? n.delete(s) : n.add(s); return n; });
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Review what we found</h1>
        <p className="mt-2 text-sm text-slate-600">This is AI-extracted from your CV. Uncheck anything wrong. Nothing saves until you confirm.</p>
      </header>

      <SectionBox icon={<User className="h-4 w-4" />} title="Contact" accepted={accepted.has('contact')} onToggle={() => toggle('contact')}>
        <p className="text-sm">{edited.fullName ?? 'Not set'} · {edited.phone ?? 'No phone'}</p>
      </SectionBox>

      <SectionBox icon={<Sparkles className="h-4 w-4" />} title={`Skills (${edited.skills?.length ?? 0})`} accepted={accepted.has('skills')} onToggle={() => toggle('skills')}>
        <div className="flex flex-wrap gap-1.5">
          {(edited.skills ?? []).map((s: string, i: number) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs">
              {s}
              <button onClick={() => setEdited({ ...edited, skills: edited.skills.filter((_: any, j: number) => j !== i) })}>
                <X className="h-3 w-3 text-slate-400" />
              </button>
            </span>
          ))}
        </div>
      </SectionBox>

      <SectionBox icon={<Briefcase className="h-4 w-4" />} title={`Experience (${edited.experience?.length ?? 0})`} accepted={accepted.has('experience')} onToggle={() => toggle('experience')}>
        {(edited.experience ?? []).map((e: any, i: number) => (
          <div key={i} className="rounded border border-slate-200 p-3 text-sm">
            <div className="font-medium">{e.title}</div>
            <div className="text-slate-600">{e.employer}</div>
          </div>
        ))}
      </SectionBox>

      <SectionBox icon={<GraduationCap className="h-4 w-4" />} title={`Education (${edited.education?.length ?? 0})`} accepted={accepted.has('education')} onToggle={() => toggle('education')}>
        {(edited.education ?? []).map((e: any, i: number) => (
          <div key={i} className="text-sm">
            <div className="font-medium">{e.institution}</div>
            {e.degree && <div className="text-slate-600">{e.degree}</div>}
          </div>
        ))}
      </SectionBox>

      <div className="flex justify-between pt-4">
        <button onClick={back} className="btn-secondary">Back</button>
        <button onClick={() => apply.mutate()} disabled={apply.isPending || accepted.size === 0} className="btn-primary">
          {apply.isPending ? 'Saving…' : `Accept ${accepted.size} section${accepted.size === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  );
}

function SectionBox({ icon, title, accepted, onToggle, children }: any) {
  return (
    <div className={`card transition-opacity ${accepted ? '' : 'opacity-50'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">{icon}<h2 className="font-medium">{title}</h2></div>
        <button onClick={onToggle} className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${accepted ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
          {accepted ? <><Check className="h-3 w-3" /> Accepted</> : 'Skipped'}
        </button>
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}
EOF

cat > "apps/web/src/app/(app)/onboarding/steps/contact-step.tsx" <<'EOF'
'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useOnboarding } from '@/lib/onboarding-context';
import { NIGERIAN_STATES } from '@/lib/constants';

export function ContactStep() {
  const { profile, next, back, saveStep } = useOnboarding();
  const { register, handleSubmit } = useForm({
    defaultValues: {
      fullName: profile?.fullName ?? '', phone: profile?.phone ?? '',
      country: profile?.country ?? 'NG', state: profile?.state ?? 'LAGOS', city: profile?.city ?? '',
      workAuthorized: profile?.workAuthorized ?? true, needsSponsorship: profile?.needsSponsorship ?? false,
    },
  });
  const [saving, setSaving] = useState(false);

  return (
    <form onSubmit={handleSubmit(async (v) => { setSaving(true); await saveStep(v); setSaving(false); next(); })} className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Where are you based?</h1>
        <p className="mt-2 text-sm text-slate-600">Used to filter jobs and flag sponsorship requirements.</p>
      </header>
      <div className="card space-y-4">
        <div><label className="label">Full name</label><input {...register('fullName')} className="input" /></div>
        <div><label className="label">Phone</label><input {...register('phone')} className="input" placeholder="+234…" /></div>
        <div className="grid gap-4 md:grid-cols-3">
          <div><label className="label">Country</label><input {...register('country')} className="input" /></div>
          <div>
            <label className="label">State</label>
            <select {...register('state')} className="input">
              {NIGERIAN_STATES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div><label className="label">City</label><input {...register('city')} className="input" /></div>
        </div>
        <div className="flex gap-6 border-t border-slate-200 pt-4">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register('workAuthorized')} /> Work authorized</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register('needsSponsorship')} /> Needs sponsorship</label>
        </div>
      </div>
      <div className="flex justify-between">
        <button type="button" onClick={back} className="btn-secondary">Back</button>
        <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Continue'}</button>
      </div>
    </form>
  );
}
EOF

cat > "apps/web/src/app/(app)/onboarding/steps/career-step.tsx" <<'EOF'
'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Plus, X } from 'lucide-react';
import { useOnboarding } from '@/lib/onboarding-context';

export function CareerStep() {
  const { profile, next, back, saveStep } = useOnboarding();
  const [roles, setRoles] = useState<string[]>(profile?.targetRoles ?? []);
  const [roleInput, setRoleInput] = useState('');
  const { register, handleSubmit } = useForm({
    defaultValues: {
      currentRole: profile?.currentRole ?? '',
      yearsExperience: profile?.yearsExperience ?? 0,
      summary: profile?.summary ?? '',
      noticePeriod: profile?.noticePeriod ?? '',
    },
  });
  const [saving, setSaving] = useState(false);

  return (
    <form onSubmit={handleSubmit(async (v) => {
      if (!roles.length) return;
      setSaving(true); await saveStep({ ...v, targetRoles: roles }); setSaving(false); next();
    })} className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">What are you looking for?</h1>
        <p className="mt-2 text-sm text-slate-600">Target roles drive the rules engine.</p>
      </header>
      <div className="card space-y-4">
        <div><label className="label">Current role</label><input {...register('currentRole')} className="input" /></div>
        <div>
          <label className="label">Target roles *</label>
          <div className="flex gap-2">
            <input value={roleInput} onChange={(e) => setRoleInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const r = roleInput.trim(); if (r && !roles.includes(r)) { setRoles([...roles, r]); setRoleInput(''); } } }}
              placeholder="Backend Engineer" className="input" />
            <button type="button" onClick={() => { const r = roleInput.trim(); if (r && !roles.includes(r)) { setRoles([...roles, r]); setRoleInput(''); } }} className="btn-secondary">
              <Plus className="h-4 w-4" />
            </button>
          </div>
          {roles.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {roles.map((r) => (
                <span key={r} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs text-brand-700">
                  {r}<button type="button" onClick={() => setRoles(roles.filter((x) => x !== r))}><X className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
          )}
        </div>
        <div><label className="label">Years of experience</label><input type="number" min={0} max={60} {...register('yearsExperience', { valueAsNumber: true })} className="input max-w-[120px]" /></div>
        <div><label className="label">Notice period</label><input {...register('noticePeriod')} className="input" /></div>
        <div><label className="label">Summary</label><textarea {...register('summary')} rows={3} className="input" /></div>
      </div>
      <div className="flex justify-between">
        <button type="button" onClick={back} className="btn-secondary">Back</button>
        <button type="submit" disabled={saving || !roles.length} className="btn-primary">{saving ? 'Saving…' : 'Continue'}</button>
      </div>
    </form>
  );
}
EOF

cat > "apps/web/src/app/(app)/onboarding/steps/skills-step.tsx" <<'EOF'
'use client';
import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useOnboarding } from '@/lib/onboarding-context';

export function SkillsStep() {
  const { profile, next, back } = useOnboarding();
  const [skills, setSkills] = useState<any[]>(
    (profile?.skills ?? []).map((s: any) => ({ name: s.skill.name, level: s.level ?? undefined })),
  );
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);

  function add() {
    const n = input.trim();
    if (!n || skills.some((s) => s.name.toLowerCase() === n.toLowerCase())) return;
    setSkills([...skills, { name: n }]); setInput('');
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Your skills</h1>
        <p className="mt-2 text-sm text-slate-600">Used by the match engine.</p>
      </header>
      <div className="card space-y-4">
        <div className="flex gap-2">
          <input value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            placeholder="e.g. TypeScript" className="input" />
          <button type="button" onClick={add} className="btn-secondary"><Plus className="h-4 w-4" /></button>
        </div>
        {skills.length === 0 ? (
          <p className="text-sm text-slate-500">Add at least one skill.</p>
        ) : (
          <ul className="space-y-2">
            {skills.map((s, i) => (
              <li key={i} className="flex items-center gap-2 rounded border border-slate-200 p-2">
                <span className="flex-1 text-sm font-medium">{s.name}</span>
                <select value={s.level ?? ''} onChange={(e) => {
                  const copy = [...skills]; copy[i] = { ...s, level: e.target.value ? Number(e.target.value) : undefined }; setSkills(copy);
                }} className="input max-w-[100px] py-1 text-xs">
                  <option value="">Level</option>
                  {[1, 2, 3, 4, 5].map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
                <button onClick={() => setSkills(skills.filter((_, j) => j !== i))} className="rounded p-1 text-red-500 hover:bg-red-50">
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex justify-between">
        <button onClick={back} className="btn-secondary">Back</button>
        <button onClick={async () => { if (!skills.length) return; setSaving(true); await api.post('/v1/profile/skills', { skills }); setSaving(false); next(); }}
          disabled={saving || !skills.length} className="btn-primary">
          {saving ? 'Saving…' : 'Continue'}
        </button>
      </div>
    </div>
  );
}
EOF

cat > "apps/web/src/app/(app)/onboarding/steps/preferences-step.tsx" <<'EOF'
'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useOnboarding } from '@/lib/onboarding-context';

export function PreferencesStep() {
  const { profile, next, back } = useOnboarding();
  const prefs = profile?.preferences ?? {};
  const [preferredStates, setPreferredStates] = useState<string[]>(prefs.preferredStates ?? ['LAGOS']);
  const [remoteOnly, setRemoteOnly] = useState(prefs.remoteOnly ?? false);
  const [salaryFloor, setSalaryFloor] = useState<number | ''>(prefs.salaryFloor ?? '');
  const [employmentTypes, setEmploymentTypes] = useState<string[]>(prefs.employmentTypes ?? ['FULL_TIME']);
  const [excludedCompanies, setExcludedCompanies] = useState((prefs.excludedCompanies ?? []).join(', '));
  const [maxPerDay, setMaxPerDay] = useState(prefs.maxApplicationsPerDay ?? 10);
  const [minMatchScore, setMinMatchScore] = useState(prefs.minMatchScore ?? 70);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await api.patch('/v1/profile/preferences', {
      preferredStates, remoteOnly,
      salaryFloor: salaryFloor === '' ? undefined : Number(salaryFloor),
      salaryCurrency: 'NGN', employmentTypes,
      excludedCompanies: excludedCompanies.split(',').map((s) => s.trim()).filter(Boolean),
      maxApplicationsPerDay: maxPerDay, minMatchScore,
    });
    setSaving(false); next();
  }

  return (
    <div className="space-y-6">
      <header><h1 className="text-2xl font-semibold">Preferences</h1><p className="mt-2 text-sm text-slate-600">These shape which jobs get matched.</p></header>
      <div className="card space-y-5">
        <div>
          <label className="label">Preferred states</label>
          <div className="grid grid-cols-3 gap-2">
            {['LAGOS', 'FCT', 'RIVERS', 'KANO', 'OYO', 'KADUNA'].map((s) => (
              <label key={s} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={preferredStates.includes(s)}
                  onChange={(e) => setPreferredStates(e.target.checked ? [...preferredStates, s] : preferredStates.filter((x) => x !== s))} />
                {s.replace(/_/g, ' ')}
              </label>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={remoteOnly} onChange={(e) => setRemoteOnly(e.target.checked)} /> Remote roles only
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <div><label className="label">Salary floor (NGN)</label>
            <input type="number" value={salaryFloor} onChange={(e) => setSalaryFloor(e.target.value === '' ? '' : Number(e.target.value))} className="input" />
          </div>
          <div><label className="label">Max applications/day</label>
            <input type="number" min={1} max={100} value={maxPerDay} onChange={(e) => setMaxPerDay(Number(e.target.value))} className="input" />
          </div>
        </div>
        <div>
          <label className="label">Employment types</label>
          <div className="flex flex-wrap gap-3">
            {['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP'].map((t) => (
              <label key={t} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={employmentTypes.includes(t)}
                  onChange={(e) => setEmploymentTypes(e.target.checked ? [...employmentTypes, t] : employmentTypes.filter((x) => x !== t))} />
                {t.replace('_', ' ')}
              </label>
            ))}
          </div>
        </div>
        <div><label className="label">Excluded companies</label><input value={excludedCompanies} onChange={(e) => setExcludedCompanies(e.target.value)} className="input" /></div>
        <div>
          <label className="label">Minimum match score: {minMatchScore}</label>
          <input type="range" min={0} max={100} value={minMatchScore} onChange={(e) => setMinMatchScore(Number(e.target.value))} className="w-full" />
        </div>
      </div>
      <div className="flex justify-between">
        <button onClick={back} className="btn-secondary">Back</button>
        <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Continue'}</button>
      </div>
    </div>
  );
}
EOF

cat > "apps/web/src/app/(app)/onboarding/steps/rules-step.tsx" <<'EOF'
'use client';
import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { useOnboarding } from '@/lib/onboarding-context';

export function RulesStep() {
  const { profile, next, back } = useOnboarding();
  const prefs = profile?.preferences ?? {};
  const [excludedCompanies, setExcludedCompanies] = useState((prefs.excludedCompanies ?? []).join(', '));
  const [postedWithin, setPostedWithin] = useState(60);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const hard: any[] = [];
    const soft: any[] = [{ type: 'POSTED_WITHIN_DAYS', days: postedWithin }];
    if (excludedCompanies.trim()) {
      hard.push({ type: 'EMPLOYER_NOT_IN', employers: excludedCompanies.split(',').map((s) => s.trim()).filter(Boolean) });
    }
    await api.post('/v1/rules', {
      name: 'Default rule',
      conditions: { hard, soft: { conditions: soft, minPassRatio: 0.5 }, minMatchScore: prefs.minMatchScore ?? 70 },
    });
    setSaving(false); next();
  }

  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-brand-600" /><h1 className="text-2xl font-semibold">Your first rule</h1></div>
        <p className="mt-2 text-sm text-slate-600">Hard rules reject outright. Soft rules contribute to a match ratio. Refine later.</p>
      </header>
      <div className="card space-y-5">
        <div><label className="label">Excluded companies (hard rule)</label>
          <input value={excludedCompanies} onChange={(e) => setExcludedCompanies(e.target.value)} placeholder="Company A, Company B" className="input" />
        </div>
        <div>
          <label className="label">Only consider jobs posted within: {postedWithin} days</label>
          <input type="range" min={7} max={180} step={7} value={postedWithin} onChange={(e) => setPostedWithin(Number(e.target.value))} className="w-full" />
        </div>
      </div>
      <div className="flex justify-between">
        <button onClick={back} className="btn-secondary">Back</button>
        <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Continue'}</button>
      </div>
    </div>
  );
}
EOF

cat > "apps/web/src/app/(app)/onboarding/steps/done-step.tsx" <<'EOF'
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Briefcase } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

export function DoneStep() {
  const router = useRouter();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function finish() {
    setSaving(true); setError(null);
    try {
      await api.post('/v1/profile/complete-onboarding');
      await qc.invalidateQueries({ queryKey: ['profile'] });
      router.replace('/dashboard');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong');
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
        <CheckCircle2 className="h-8 w-8 text-green-600" />
      </div>
      <h1 className="text-2xl font-semibold">You're set up</h1>
      <p className="mt-2 text-sm text-slate-600">From now on, we'll match new jobs against your profile and rules.</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button onClick={finish} disabled={saving} className="btn-primary mx-auto">
        <Briefcase className="h-4 w-4" /> {saving ? 'Finishing…' : 'Go to dashboard'}
      </button>
    </div>
  );
}
EOF

# ============================================================
# scripts/e2e-smoke.sh
# ============================================================

cat > scripts/e2e-smoke.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

API=${API:-http://localhost:3001/api/v1}

echo "→ Registering test user"
EMAIL="e2e-$(date +%s)@example.test"
REG=$(curl -sS -X POST "$API/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"correct-horse-battery-staple\"}")
echo "$REG"

echo "→ Logging in"
LOGIN=$(curl -sS -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"correct-horse-battery-staple\"}")
TOKEN=$(echo "$LOGIN" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
if [ -z "$TOKEN" ]; then echo "Failed to obtain token"; exit 1; fi

echo "→ Creating profile"
curl -sS -X PATCH "$API/profile" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{
  "fullName": "Test User",
  "country": "NG",
  "state": "LAGOS",
  "targetRoles": ["Software Engineer"],
  "yearsExperience": 5
}' > /dev/null

echo "→ Setting skills"
curl -sS -X POST "$API/profile/skills" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"skills":[{"name":"TypeScript"},{"name":"Node.js"}]}' > /dev/null

echo "→ Setting preferences"
curl -sS -X PATCH "$API/profile/preferences" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{
  "preferredStates": ["LAGOS"],
  "employmentTypes": ["FULL_TIME"],
  "minMatchScore": 50,
  "maxApplicationsPerDay": 50
}' > /dev/null

echo "→ Creating rule"
curl -sS -X POST "$API/rules" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{
  "name": "E2E rule",
  "conditions": {
    "hard": [{"type": "STATE_IN", "states": ["LAGOS"]}],
    "soft": {"conditions": [], "minPassRatio": 0.5},
    "minMatchScore": 50
  }
}' > /dev/null

echo "→ Seeding a mock job"
curl -sS -X POST "$API/admin/test/seed-job" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{
  "providerKey": "mock-submission",
  "externalId": "test-job-1",
  "title": "Software Engineer",
  "employer": "Acme Nigeria",
  "state": "LAGOS",
  "workArrangement": "HYBRID",
  "employmentType": "FULL_TIME",
  "requiredSkills": ["typescript", "node"],
  "sourceUrl": "https://example.test/job/1"
}' > /dev/null

echo "→ Triggering match-recent"
curl -sS -X POST "$API/admin/test/trigger-match-recent" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}' > /dev/null

echo "→ Waiting for application to appear"
sleep 6
APPS=$(curl -sS "$API/applications" -H "Authorization: Bearer $TOKEN")
echo "$APPS" | head -c 2000
echo
echo "✓ Smoke test complete. Check the applications list above."
EOF
chmod +x scripts/e2e-smoke.sh

# ============================================================
# README.md
# ============================================================

cat > README.md <<'EOF'
# SHS Job Pilot

Automated job discovery, matching, and application platform. Nigeria-focused.

## Stack

- **Frontend:** Next.js 15 (App Router), TypeScript, Tailwind, TanStack Query
- **Backend:** NestJS, Prisma, PostgreSQL
- **Queue:** Redis + BullMQ
- **AI:** Gemini (via `@google/genai`)
- **Providers:** Adzuna (Nigerian jobs). LinkedIn, Indeed, and Jobberman are
  supported as **manual-application sources only** — their terms of service
  prohibit automated scraping and submission.

## Quick start

```bash
cp .env.example .env
# Edit .env — set JWT_SECRET and SESSION_SECRET to random 48-byte strings.
# Leave AI_API_KEY blank to run in mock mode.

pnpm install
docker compose up -d
pnpm prisma migrate dev --name init
pnpm dev