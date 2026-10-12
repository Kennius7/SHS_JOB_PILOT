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

  const { data: notif } = useQuery({
    queryKey: ['notif-count'],
    queryFn: () => api.get<{ unreadCount: number }>('/v1/notifications/unread-count'),
    enabled: !!user && !isOnboarding,
    refetchInterval: 60_000,
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
            {(notif?.unreadCount ?? 0) > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold text-white">
                {notif!.unreadCount > 9 ? '9+' : notif!.unreadCount}
              </span>
            )}
          </Link>
        </header>
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
