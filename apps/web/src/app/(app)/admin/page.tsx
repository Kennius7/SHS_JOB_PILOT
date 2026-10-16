'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Database,
  History,
  Layers,
  RefreshCw,
  Server,
  ShieldAlert,
  Wifi,
  XCircle,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { DbExplorer } from './db-explorer';
import { RedisExplorer } from './redis-explorer';
import { WorkersPanel } from './workers-panel';

interface ProviderCapabilities {
  searchJobs: boolean;
  retrieveJobDetails: boolean;
  submitApplications: boolean;
  verifySubmission: boolean;
  supportsPagination: boolean;
  requiresCredentials: boolean;
  requiresEmployerAuthorization: boolean;
  accessMode: string;
}

interface Provider {
  key: string;
  displayName: string;
  accessMode: string;
  capabilities: ProviderCapabilities;
  enabled: boolean;
  configured: boolean;
  healthy: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
}

interface QueueCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}
interface QueueInfo {
  name: string;
  counts: QueueCounts;
  paused: boolean;
}

interface HealthCheck {
  ok: boolean;
  detail?: string;
}
interface HealthResponse {
  status: 'ok' | 'degraded';
  checks: Record<string, HealthCheck>;
  providers: { healthy: boolean; count: number }[];
}

interface AuditEntry {
  id: string;
  email: string | null;
  action: string;
  target: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}
interface AuditResponse {
  items: AuditEntry[];
  total: number;
  page: number;
  limit: number;
}

const AUDIT_ACTIONS = ['auth.login', 'admin.sync'];

const fmtMeta = (m: Record<string, unknown> | null) =>
  m && Object.keys(m).length ? JSON.stringify(m) : '';

function Badge({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        ok ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-green-600' : 'bg-red-600'}`} />
      {ok ? 'Healthy' : 'Down'}
    </span>
  );
}

export default function AdminPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && user && !user.isAdmin) router.replace('/dashboard');
  }, [loading, user, router]);

  const health = useQuery({
    queryKey: ['admin-health'],
    queryFn: () => api.get<HealthResponse>('/v1/admin/health'),
    enabled: user?.isAdmin === true,
  });
  const queues = useQuery({
    queryKey: ['admin-queues'],
    queryFn: () => api.get<{ queues: QueueInfo[] }>('/v1/admin/queues'),
    enabled: user?.isAdmin === true,
  });
  const providers = useQuery({
    queryKey: ['admin-providers'],
    queryFn: () => api.get<Provider[]>('/v1/admin/providers'),
    enabled: user?.isAdmin === true,
  });

  const [auditPage, setAuditPage] = useState(1);
  const [auditAction, setAuditAction] = useState('');
  const audit = useQuery({
    queryKey: ['admin-audit', auditPage, auditAction],
    queryFn: () =>
      api.get<AuditResponse>(
        `/v1/admin/audit?page=${auditPage}&limit=25${auditAction ? `&action=${auditAction}` : ''}`,
      ),
    enabled: user?.isAdmin === true,
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['admin-health'] });
    qc.invalidateQueries({ queryKey: ['admin-queues'] });
    qc.invalidateQueries({ queryKey: ['admin-providers'] });
    qc.invalidateQueries({ queryKey: ['admin-audit'] });
  };

  const sync = useMutation({
    mutationFn: (key: string) => api.post(`/v1/admin/providers/${key}/sync`),
    onSuccess: invalidateAll,
  });

  if (loading || !user?.isAdmin) {
    return <div className="text-sm text-slate-500">Loading…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Admin console</h1>
          <p className="text-sm text-slate-500">
            Platform health, job queues, and provider registry.
          </p>
        </div>
        <button onClick={invalidateAll} className="btn-secondary">
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      {/* Health */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Object.entries(health.data?.checks ?? {}).map(([name, check]) => (
          <div key={name} className="card">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-900">
              {name === 'database' ? (
                <Database className="h-4 w-4 text-slate-400" />
              ) : (
                <Wifi className="h-4 w-4 text-slate-400" />
              )}
              {name}
            </div>
            <Badge ok={check.ok} />
            {check.detail && (
              <p className="mt-2 break-all text-xs text-slate-400">{check.detail}</p>
            )}
          </div>
        ))}
        <div className="card">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-900">
            <Server className="h-4 w-4 text-slate-400" /> Providers
          </div>
          <p className="text-sm text-slate-600">
            <span className="text-green-700">
              {(health.data?.providers ?? [])
                .filter((p) => p.healthy)
                .reduce((n, p) => n + p.count, 0)}
            </span>
            {' / '}
            {(health.data?.providers ?? []).reduce((n, p) => n + p.count, 0)} healthy
          </p>
        </div>
      </section>

      {/* Queues */}
      <section className="card">
        <div className="mb-3 flex items-center gap-2 font-medium text-slate-900">
          <Layers className="h-4 w-4" /> Job queues
        </div>
        {queues.isLoading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : !queues.data?.queues?.length ? (
          <p className="text-sm text-slate-500">No queues reported.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-4 font-medium">Queue</th>
                  <th className="px-4 py-2 font-medium">Waiting</th>
                  <th className="px-4 py-2 font-medium">Active</th>
                  <th className="px-4 py-2 font-medium">Delayed</th>
                  <th className="px-4 py-2 font-medium">Completed</th>
                  <th className="px-4 py-2 font-medium">Failed</th>
                  <th className="px-4 py-2 text-right font-medium">State</th>
                </tr>
              </thead>
              <tbody>
                {queues.data.queues.map((q) => (
                  <tr key={q.name} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-4 font-medium text-slate-900">{q.name}</td>
                    <td className="px-4 py-2">{q.counts.waiting}</td>
                    <td className="px-4 py-2">{q.counts.active}</td>
                    <td className="px-4 py-2">{q.counts.delayed}</td>
                    <td className="px-4 py-2 text-slate-500">{q.counts.completed}</td>
                    <td
                      className={`px-4 py-2 ${q.counts.failed > 0 ? 'text-red-600' : 'text-slate-500'}`}
                    >
                      {q.counts.failed}
                    </td>
                    <td className="py-2 text-right">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          q.paused ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'
                        }`}
                      >
                        {q.paused ? 'Paused' : 'Active'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Workers */}
      <WorkersPanel />

      {/* Postgres browser */}
      <DbExplorer />

      {/* Redis browser */}
      <RedisExplorer />

      {/* Providers */}
      <section className="card">
        <div className="mb-3 flex items-center gap-2 font-medium text-slate-900">
          <Activity className="h-4 w-4" /> Provider registry
        </div>
        {providers.isLoading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : !providers.data?.length ? (
          <p className="text-sm text-slate-500">No providers registered yet. Run the seed.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-4 font-medium">Provider</th>
                  <th className="px-4 py-2 font-medium">Access</th>
                  <th className="px-4 py-2 font-medium">Search</th>
                  <th className="px-4 py-2 font-medium">Submit</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Last sync</th>
                  <th className="px-4 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {providers.data.map((p) => {
                  const searchable = p.capabilities.searchJobs;
                  const error = p.lastError;
                  return (
                    <tr key={p.key} className="border-b border-slate-100 align-top last:border-0">
                      <td className="py-2 pr-4">
                        <p className="font-medium text-slate-900">{p.displayName}</p>
                        <p className="text-xs text-slate-400">{p.key}</p>
                      </td>
                      <td className="px-4 py-2">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                          {p.accessMode.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-2">{p.capabilities.searchJobs ? 'Yes' : '—'}</td>
                      <td className="px-4 py-2">
                        {p.capabilities.submitApplications ? 'Yes' : '—'}
                      </td>
                      <td className="px-4 py-2">
                        {error ? (
                          <span
                            className="inline-flex items-center gap-1 text-red-700"
                            title={error}
                          >
                            <XCircle className="h-3.5 w-3.5" /> error
                          </span>
                        ) : p.healthy ? (
                          <span className="text-green-700">healthy</span>
                        ) : (
                          <span className="text-slate-500">idle</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-500">
                        {p.lastSyncAt ? new Date(p.lastSyncAt).toLocaleString() : 'never'}
                      </td>
                      <td className="py-2 text-right">
                        {searchable && (
                          <button
                            onClick={() => sync.mutate(p.key)}
                            disabled={sync.isPending || !p.configured}
                            className="btn-secondary"
                            title={p.configured ? undefined : 'Not configured — set env vars first'}
                          >
                            <RefreshCw className="h-3.5 w-3.5" /> Sync now
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {sync.isError && (
              <p className="mt-3 flex items-center gap-1 text-xs text-red-600">
                <ShieldAlert className="h-3.5 w-3.5" /> {(sync.error as Error).message}
              </p>
            )}
          </div>
        )}
      </section>

      {/* Audit log */}
      <section className="card">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 font-medium text-slate-900">
            <History className="h-4 w-4" /> Audit log
          </div>
          <select
            value={auditAction}
            onChange={(e) => {
              setAuditAction(e.target.value);
              setAuditPage(1);
            }}
            className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600"
          >
            <option value="">All actions</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        {audit.isLoading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : !audit.data?.items?.length ? (
          <p className="text-sm text-slate-500">No audit events recorded yet.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-4 font-medium">When</th>
                    <th className="px-4 py-2 font-medium">User</th>
                    <th className="px-4 py-2 font-medium">Action</th>
                    <th className="px-4 py-2 font-medium">Target</th>
                    <th className="px-4 py-2 font-medium">Details</th>
                    <th className="px-4 py-2 font-medium">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.data.items.map((e) => (
                    <tr key={e.id} className="border-b border-slate-100 align-top last:border-0">
                      <td className="whitespace-nowrap py-2 pr-4 text-xs text-slate-500">
                        {new Date(e.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-slate-700">{e.email ?? '—'}</td>
                      <td className="px-4 py-2">
                        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-brand-700">
                          {e.action}
                        </code>
                      </td>
                      <td className="px-4 py-2 text-slate-600">{e.target ?? '—'}</td>
                      <td className="px-4 py-2 text-xs text-slate-500">{fmtMeta(e.metadata)}</td>
                      <td className="px-4 py-2 text-xs text-slate-500">{e.ip ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
              <span>
                Page {audit.data.page} · {audit.data.total} events
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
                  disabled={audit.data.page <= 1}
                  className="btn-secondary"
                >
                  Prev
                </button>
                <button
                  onClick={() => setAuditPage((p) => p + 1)}
                  disabled={audit.data.page * audit.data.limit >= audit.data.total}
                  className="btn-secondary"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
