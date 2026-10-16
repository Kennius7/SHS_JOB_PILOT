'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, ApiError } from '@/lib/api';
import { ThemeToggle } from '@/components/theme-toggle';

const schema = z
  .object({
    password: z.string().min(8, 'At least 8 characters'),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  });
type FormValues = z.infer<typeof schema>;

export default function ResetPasswordPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get('token'));
    setReady(true);
  }, []);

  async function onSubmit(values: FormValues) {
    setError(null);
    try {
      await api.post('/v1/auth/reset-password', { token, password: values.password });
      router.push('/login');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Reset failed');
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm">
        <form onSubmit={handleSubmit(onSubmit)} className="card space-y-4">
          <h1 className="text-xl font-semibold">Choose a new password</h1>
          {ready && !token ? (
            <>
              <p className="text-sm text-red-600 dark:text-red-400">
                This reset link is missing its token.
              </p>
              <Link href="/forgot-password" className="btn-primary block w-full">
                Request a new link
              </Link>
            </>
          ) : (
            <>
              <div>
                <label className="label">New password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  {...register('password')}
                  className="input"
                />
                {formState.errors.password && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                    {formState.errors.password.message}
                  </p>
                )}
              </div>
              <div>
                <label className="label">Confirm new password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  {...register('confirm')}
                  className="input"
                />
                {formState.errors.confirm && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                    {formState.errors.confirm.message}
                  </p>
                )}
              </div>
              {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
              <button
                type="submit"
                disabled={formState.isSubmitting}
                className="btn-primary w-full"
              >
                {formState.isSubmitting ? 'Resetting…' : 'Reset password'}
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
