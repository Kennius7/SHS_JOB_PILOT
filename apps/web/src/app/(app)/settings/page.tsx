'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Pause, Play, ShieldAlert, Trash2, User, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

interface MeResponse {
  id: string;
  email: string;
  role: 'USER' | 'ADMIN';
  emailVerified: string | null;
  createdAt: string;
  profile: { fullName: string | null; onboardingCompletedAt: string | null } | null;
}

interface AutomationStatus {
  autoSubmitEnabled: boolean;
  coverLetterAutoGen: boolean;
  cvTailoringAllowed: boolean;
  reviewOnMissingRequired: boolean;
  minMatchScore: number;
  hasActiveRule: boolean;
  limits: { maxApplicationsPerDay: number; maxApplicationsPerWeek: number };
  usage: { submittedToday: number; queued: number; awaitingApproval: number };
}

interface UsageResponse {
  periodStart: string;
  items: { kind: string; amount: number; count: number }[];
  totalAmount: number;
  budget: { perUserMonthlyUsd: number; platformMonthlyUsd: number };
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const { logout } = useAuth();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<MeResponse>('/v1/users/me') });
  const automation = useQuery({
    queryKey: ['automation'],
    queryFn: () => api.get<AutomationStatus>('/v1/automation/status'),
  });
  const usage = useQuery({
    queryKey: ['usage'],
    queryFn: () => api.get<UsageResponse>('/v1/usage'),
  });

  const pause = useMutation({
    mutationFn: () => api.post('/v1/automation/pause'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['automation'] }),
  });
  const resume = useMutation({
    mutationFn: () => api.post('/v1/automation/resume'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['automation'] }),
  });
  const deleteAccount = useMutation({
    mutationFn: () => api.delete('/v1/users/me'),
    onSuccess: async () => {
      await logout();
    },
  });
  const resendVerification = useMutation({
    mutationFn: () => api.post('/v1/auth/resend-verification'),
  });

  const auto = automation.data;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-lg font-semibold">Account settings</h1>

      <section className="card">
        <div className="mb-3 flex items-center gap-2 font-medium text-foreground">
          <User className="h-4 w-4" /> Account
        </div>
        {me.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Email</dt>
              <dd>{me.data?.email}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Role</dt>
              <dd>{me.data?.role}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Name</dt>
              <dd>{me.data?.profile?.fullName ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Email verified</dt>
              <dd>{me.data?.emailVerified ? 'Yes' : 'No'}</dd>
            </div>
          </dl>
        )}
        {!me.isLoading && !me.data?.emailVerified && (
          <div className="mt-4 border-t border-border pt-4">
            {resendVerification.isSuccess ? (
              <p className="text-sm text-green-700 dark:text-green-400">
                Verification email sent. Check your inbox.
              </p>
            ) : (
              <>
                <p className="mb-2 text-sm text-amber-600 dark:text-amber-400">
                  Your email is not verified yet.
                </p>
                <button
                  onClick={() => resendVerification.mutate()}
                  className="btn-secondary"
                  disabled={resendVerification.isPending}
                >
                  {resendVerification.isPending ? 'Sending…' : 'Resend verification email'}
                </button>
                {resendVerification.isError && (
                  <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                    {(resendVerification.error as Error).message}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <div className="mb-3 flex items-center gap-2 font-medium text-foreground">
          <ShieldAlert className="h-4 w-4" /> Automatic application
        </div>
        {automation.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : automation.isError ? (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            Set up your career preferences before configuring automation.
          </p>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">
                  Status:{' '}
                  <span
                    className={
                      auto?.autoSubmitEnabled
                        ? 'text-green-700 dark:text-green-400'
                        : 'text-muted-foreground'
                    }
                  >
                    {auto?.autoSubmitEnabled ? 'Running' : 'Paused'}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Min match score {auto?.minMatchScore} · {auto?.usage?.submittedToday} submitted
                  today · {auto?.usage?.awaitingApproval} awaiting approval
                </p>
              </div>
              {auto?.autoSubmitEnabled ? (
                <button
                  onClick={() => pause.mutate()}
                  className="btn-secondary"
                  disabled={pause.isPending}
                >
                  <Pause className="h-4 w-4" /> Pause
                </button>
              ) : (
                <button
                  onClick={() => resume.mutate()}
                  className="btn-primary"
                  disabled={resume.isPending || !auto?.hasActiveRule}
                  title={auto?.hasActiveRule ? undefined : 'Create an active rule first'}
                >
                  <Play className="h-4 w-4" /> Resume
                </button>
              )}
            </div>
            {!auto?.hasActiveRule && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                You need an active application rule to enable automation.
              </p>
            )}
            {resume.isError && (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                {(resume.error as Error).message}
              </p>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Limits: {auto?.limits?.maxApplicationsPerDay ?? 0}/day ·{' '}
              {auto?.limits?.maxApplicationsPerWeek ?? 0}/week
            </p>
          </>
        )}
      </section>

      <section className="card">
        <div className="mb-3 flex items-center gap-2 font-medium text-foreground">
          <Wallet className="h-4 w-4" /> AI usage this month
        </div>
        {usage.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : usage.data?.items?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {usage.data.items.map((i) => (
                  <tr key={i.kind} className="border-b border-border last:border-0">
                    <td className="py-1.5">{i.kind}</td>
                    <td className="py-1.5 text-right text-muted-foreground">{i.count} calls</td>
                    <td className="py-1.5 text-right">${i.amount.toFixed(4)}</td>
                  </tr>
                ))}
                <tr>
                  <td className="pt-2 font-medium">Total</td>
                  <td />
                  <td className="pt-2 text-right font-medium">
                    ${(usage.data.totalAmount ?? 0).toFixed(4)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No AI usage recorded this month.</p>
        )}
        {usage.data && (
          <p className="mt-2 text-xs text-muted-foreground">
            Monthly budget: ${usage.data.budget.perUserMonthlyUsd}/user
          </p>
        )}
      </section>

      <section className="card border-red-200 dark:border-red-500/30">
        <div className="mb-3 flex items-center gap-2 font-medium text-red-700 dark:text-red-400">
          <Trash2 className="h-4 w-4" /> Danger zone
        </div>
        {confirmDelete ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              This deactivates your account and revokes all sessions. Are you sure?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => deleteAccount.mutate()}
                className="btn-primary bg-red-600 hover:bg-red-700"
                disabled={deleteAccount.isPending}
              >
                Yes, delete my account
              </button>
              <button onClick={() => setConfirmDelete(false)} className="btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="btn-secondary text-red-700 dark:text-red-400"
          >
            Delete account
          </button>
        )}
      </section>
    </div>
  );
}
