'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, MapPin, Building2 } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface Job {
  id: string;
  title: string;
  employer: string;
  city?: string;
  state?: string;
  workArrangement: string;
  employmentType: string;
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  publishedAt?: string;
  providerKey: string;
  attribution?: string;
}
interface JobsResponse {
  items: Job[];
  total: number;
  page: number;
  pageSize: number;
}

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
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Search by title, employer, or skill"
            className="input pl-9"
          />
        </div>
        <select
          value={state}
          onChange={(e) => {
            setState(e.target.value);
            setPage(1);
          }}
          className="input md:w-48"
        >
          <option value="">All states</option>
          <option value="LAGOS">Lagos</option>
          <option value="FCT">FCT (Abuja)</option>
          <option value="RIVERS">Rivers</option>
        </select>
      </div>

      {isLoading ? (
        <div className="card text-sm text-muted-foreground">Loading jobs…</div>
      ) : !data?.items?.length ? (
        <div className="card text-center text-sm text-muted-foreground">
          No jobs match those filters yet. Try widening your search, or wait for the next provider
          sync.
        </div>
      ) : (
        <ul className="space-y-3">
          {data.items.map((job) => (
            <li key={job.id} className="card">
              <Link href={`/jobs/${job.id}`} className="block">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold text-foreground">{job.title}</h3>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Building2 className="h-3.5 w-3.5" />
                        {job.employer}
                      </span>
                      {(job.city || job.state) && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" />
                          {[job.city, job.state].filter(Boolean).join(', ')}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <span className="rounded bg-muted px-2 py-0.5">{job.workArrangement}</span>
                      <span className="rounded bg-muted px-2 py-0.5">{job.employmentType}</span>
                      {job.salaryMin != null && (
                        <span className="rounded bg-green-50 dark:bg-green-500/10 px-2 py-0.5 text-green-700 dark:text-green-400">
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
