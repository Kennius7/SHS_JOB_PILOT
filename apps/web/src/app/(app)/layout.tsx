'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  Briefcase,
  FileText,
  ListChecks,
  Settings,
  Shield,
  LogOut,
  Bell,
  ShieldCheck,
  Menu,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { ThemeToggle } from '@/components/theme-toggle';

const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/jobs', label: 'Jobs', icon: Briefcase },
  { href: '/applications', label: 'Applications', icon: ListChecks },
  { href: '/documents', label: 'Documents', icon: FileText },
  { href: '/rules', label: 'Rules', icon: Shield },
  { href: '/settings', label: 'Settings', icon: Settings },
];

const ADMIN_NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/admin', label: 'Admin', icon: ShieldCheck },
];

function NavLinks({
  pathname,
  isAdmin,
  onNavigate,
}: {
  pathname: string | null;
  isAdmin?: boolean;
  onNavigate?: () => void;
}) {
  const items = isAdmin ? [...NAV, ...ADMIN_NAV] : NAV;
  return (
    <nav className="flex-1 space-y-1 overflow-y-auto p-3">
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname?.startsWith(href + '/');
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
              active
                ? 'bg-brand-50 font-medium text-brand-700'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarFooter({ email, onLogout }: { email?: string; onLogout: () => void }) {
  return (
    <div className="border-t border-border p-3">
      <div className="mb-2 truncate px-3 text-xs text-muted-foreground">{email}</div>
      <button
        onClick={onLogout}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <LogOut className="h-4 w-4" />
        Sign out
      </button>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isOnboarding = pathname?.startsWith('/onboarding') ?? false;
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get<any>('/v1/profile'),
    enabled: !!user && !isOnboarding,
  });

  const { data: notif } = useQuery({
    queryKey: ['notif-count'],
    queryFn: () => api.get<{ unreadCount: number }>('/v1/notifications/unread-count'),
    enabled: !!user && !isOnboarding,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!loading && !user) router.replace('/');
  }, [loading, user, router]);

  useEffect(() => {
    if (!user || !profile || isOnboarding) return;
    const onboardingDone = !!profile.onboardingCompletedAt;
    if (!onboardingDone) router.replace('/onboarding');
  }, [user, profile, isOnboarding, router]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNavOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileNavOpen]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (isOnboarding) {
    return (
      <div className="min-h-screen bg-background">
        <header className="flex h-16 items-center justify-between border-b border-border px-4 sm:px-6">
          <div className="flex items-center gap-2 font-semibold">
            <Briefcase className="h-5 w-5 text-brand-600" />
            Job Pilot
          </div>
          <ThemeToggle />
        </header>
        {children}
      </div>
    );
  }

  const title = pathname?.split('/')[1] ?? 'Dashboard';
  const unread = notif?.unreadCount ?? 0;

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r border-border bg-card lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
        <div className="flex h-16 items-center gap-2 border-b border-border px-6">
          <Briefcase className="h-5 w-5 text-brand-600" />
          <span className="font-semibold">Job Pilot</span>
        </div>
        <NavLinks pathname={pathname} isAdmin={user.isAdmin} />
        <SidebarFooter email={user.email} onLogout={logout} />
      </aside>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col border-r border-border bg-card shadow-xl">
            <div className="flex h-16 items-center justify-between border-b border-border px-4">
              <div className="flex items-center gap-2 font-semibold">
                <Briefcase className="h-5 w-5 text-brand-600" />
                Job Pilot
              </div>
              <button
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close menu"
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <NavLinks
              pathname={pathname}
              isAdmin={user.isAdmin}
              onNavigate={() => setMobileNavOpen(false)}
            />
            <SidebarFooter email={user.email} onLogout={logout} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border bg-card/95 px-4 backdrop-blur sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <button
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open menu"
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <h1 className="truncate text-lg font-semibold capitalize">{title}</h1>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Link
              href="/notifications"
              className="relative rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Bell className="h-5 w-5" />
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold text-white">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </Link>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
