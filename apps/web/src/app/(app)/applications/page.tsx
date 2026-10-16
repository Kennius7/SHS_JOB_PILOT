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
              tab === t.key
                ? 'border-brand-500 font-medium text-brand-700'
                : 'border-transparent text-slate-600 hover:text-slate-900'
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
                  <Link
                    href={`/applications/${app.id}`}
                    className="font-semibold hover:text-brand-600"
                  >
                    {app.job.title}
                  </Link>
                  <p className="text-sm text-slate-600">{app.job.employer}</p>
                  {app.matchScore != null && (
                    <p className="mt-1 text-xs text-slate-500">
                      Match score: {Math.round(app.matchScore)}
                    </p>
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
