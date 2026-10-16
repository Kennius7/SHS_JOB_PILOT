'use client';

import { useQuery } from '@tanstack/react-query';
import { Cpu, RefreshCw, Repeat } from 'lucide-react';
import { api } from '@/lib/api';

interface WorkerInfo {
  [field: string]: string;
}
interface RepeatableJob {
  key: string;
  name: string;
  pattern: string | null;
  every: string | null;
  next: number | null;
  tz: string | null;
}
interface QueueWorkers {
  name: string;
  paused: boolean;
  counts: Record<string, number>;
  workerCount: number;
  workers: WorkerInfo[];
  repeatable: RepeatableJob[];
}

export function WorkersPanel() {
  const workers = useQuery({
    queryKey: ['admin-workers'],
    queryFn: () => api.get<{ queues: QueueWorkers[] }>('/v1/admin/workers'),
    refetchInterval: 10000,
  });

  return (
    <section className="card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-medium text-foreground">
          <Cpu className="h-4 w-4" /> Workers
        </div>
        <button onClick={() => workers.refetch()} className="btn-secondary">
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      {workers.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : workers.isError ? (
        <p className="text-sm text-red-600 dark:text-red-400">{(workers.error as Error).message}</p>
      ) : !workers.data?.queues?.length ? (
        <p className="text-sm text-muted-foreground">No workers reported.</p>
      ) : (
        <div className="space-y-4">
          {workers.data.queues.map((q) => (
            <div key={q.name} className="rounded-lg border border-border">
              <div className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-2">
                <span className="font-medium text-foreground">{q.name}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    q.paused
                      ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300'
                      : 'bg-green-100 dark:bg-green-500/20 text-green-800 dark:text-green-300'
                  }`}
                >
                  {q.paused ? 'Paused' : 'Active'}
                </span>
                <span className="text-xs text-muted-foreground">
                  {q.workerCount} worker{q.workerCount === 1 ? '' : 's'} connected
                </span>
                <span className="ml-auto flex flex-wrap gap-2 text-xs text-muted-foreground">
                  {Object.entries(q.counts).map(([state, n]) => (
                    <span key={state}>
                      {state}: <span className="text-foreground">{n}</span>
                    </span>
                  ))}
                </span>
              </div>

              {q.workerCount === 0 ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">No live workers.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2 font-medium">Name</th>
                        <th className="px-3 py-2 font-medium">Address</th>
                        <th className="px-3 py-2 font-medium">Age</th>
                        <th className="px-3 py-2 font-medium">Idle</th>
                        <th className="px-3 py-2 font-medium">Flags</th>
                        <th className="px-3 py-2 font-medium">DB</th>
                      </tr>
                    </thead>
                    <tbody>
                      {q.workers.map((w, i) => (
                        <tr key={i} className="border-b border-border last:border-0">
                          <td className="px-3 py-2 font-mono text-xs text-foreground">
                            {w.name ?? '—'}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                            {w.addr ?? '—'}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{w.age ?? '—'}</td>
                          <td className="px-3 py-2 text-muted-foreground">{w.idle ?? '—'}</td>
                          <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                            {w.flags ?? '—'}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{w.db ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {q.repeatable.length > 0 && (
                <div className="border-t border-border px-3 py-2">
                  <p className="mb-2 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                    <Repeat className="h-3.5 w-3.5" /> Repeatable jobs
                  </p>
                  <ul className="space-y-1">
                    {q.repeatable.map((r) => (
                      <li
                        key={r.key}
                        className="flex flex-wrap gap-x-3 text-xs text-muted-foreground"
                      >
                        <span className="font-medium text-foreground">{r.name}</span>
                        {r.pattern && <span>cron: {r.pattern}</span>}
                        {r.every && <span>every: {r.every}ms</span>}
                        {r.next && <span>next: {new Date(r.next).toLocaleString()}</span>}
                        {r.tz && <span>tz: {r.tz}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
