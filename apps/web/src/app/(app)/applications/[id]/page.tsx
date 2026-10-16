'use client';

import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, AlertCircle, Clock, FileText, ExternalLink, Ban } from 'lucide-react';
import { api } from '@/lib/api';

const STATE_TONES: Record<string, string> = {
  AWAITING_APPROVAL: 'bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300',
  QUEUED: 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300',
  SUBMITTING: 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300',
  SUBMITTED: 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400',
  CONFIRMED: 'bg-green-100 dark:bg-green-500/20 text-green-800 dark:text-green-300',
  SKIPPED: 'bg-muted text-muted-foreground',
  NEEDS_USER_INPUT: 'bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300',
  MANUAL_APPLICATION_REQUIRED:
    'bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300',
  FAILED: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400',
  UNKNOWN_OUTCOME: 'bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300',
};

export default function ApplicationDetailPage() {
  const params = useParams<{ id: string }>();
  const qc = useQueryClient();

  const { data: app, isLoading } = useQuery({
    queryKey: ['application', params.id],
    queryFn: () => api.get<any>(`/v1/applications/${params.id}`),
    refetchInterval: (q) =>
      ['SUBMITTING', 'QUEUED', 'SUBMITTED'].includes(q.state.data?.state) ? 5000 : false,
  });

  const approve = useMutation({
    mutationFn: () => api.post(`/v1/applications/${params.id}/approve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['application', params.id] }),
  });
  const skip = useMutation({
    mutationFn: () => api.post(`/v1/applications/${params.id}/skip`, { reason: 'user_skipped' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['application', params.id] }),
  });

  if (isLoading) return <div className="card text-sm text-muted-foreground">Loading…</div>;
  if (!app) return <div className="card text-sm text-muted-foreground">Not found.</div>;

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold">{app.job.title}</h1>
            <p className="text-sm text-muted-foreground">{app.job.employer}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={`rounded px-2 py-0.5 text-xs ${STATE_TONES[app.state] ?? ''}`}>
                {app.state.replace(/_/g, ' ')}
              </span>
              {app.matchScore != null && (
                <span className="rounded bg-muted px-2 py-0.5 text-xs">
                  Match {Math.round(app.matchScore)}
                </span>
              )}
              <span className="text-xs text-muted-foreground">via {app.job.providerKey}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {app.state === 'AWAITING_APPROVAL' && (
              <>
                <button
                  onClick={() => approve.mutate()}
                  disabled={approve.isPending}
                  className="btn-primary"
                >
                  <CheckCircle2 className="h-4 w-4" /> Approve & queue
                </button>
                <button
                  onClick={() => skip.mutate()}
                  disabled={skip.isPending}
                  className="btn-secondary"
                >
                  <Ban className="h-4 w-4" /> Skip
                </button>
              </>
            )}
            {app.state === 'MANUAL_APPLICATION_REQUIRED' && app.job.applyUrl && (
              <a
                href={app.job.applyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary"
              >
                <ExternalLink className="h-4 w-4" /> Apply on site
              </a>
            )}
          </div>
        </div>

        {app.lastError && (
          <div className="mt-4 rounded bg-red-50 dark:bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
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
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div>
                  <div>
                    {e.fromState && <span className="text-muted-foreground">{e.fromState} → </span>}
                    <span className="font-medium">{e.toState}</span>
                  </div>
                  {e.note && <div className="text-xs text-muted-foreground">{e.note}</div>}
                  <div className="text-xs text-muted-foreground">
                    {new Date(e.createdAt).toLocaleString()}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="card">
          <h2 className="font-semibold">Submission attempts</h2>
          {!app.attempts?.length ? (
            <p className="mt-3 text-sm text-muted-foreground">No submission attempts yet.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {app.attempts.map((a: any) => (
                <li key={a.id} className="rounded border border-border p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Attempt {a.attemptNumber}</span>
                    <span className="text-xs text-muted-foreground">{a.outcome}</span>
                  </div>
                  {a.errorMessage && (
                    <div className="mt-1 text-xs text-red-600 dark:text-red-400">
                      {a.errorMessage}
                    </div>
                  )}
                  {a.providerRefId && (
                    <div className="mt-1 font-mono text-xs text-muted-foreground">
                      ref: {a.providerRefId}
                    </div>
                  )}
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
              <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-background p-3 text-xs">
                {m.content ?? '(no content)'}
              </pre>
            </details>
          ))}
        </div>
      )}

      <details className="card">
        <summary className="cursor-pointer text-sm font-medium">Rule evaluation</summary>
        <pre className="mt-3 overflow-auto rounded bg-background p-3 text-xs">
          {JSON.stringify(app.ruleEvalJson, null, 2)}
        </pre>
      </details>
    </div>
  );
}
