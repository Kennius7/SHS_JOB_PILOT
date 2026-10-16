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
  if (isLoading) return <div className="card text-sm text-muted-foreground">Loading…</div>;
  if (!job) return <div className="card text-sm text-muted-foreground">Not found.</div>;
  return (
    <div className="space-y-6">
      <div className="card">
        <h1 className="text-xl font-semibold">{job.title}</h1>
        <p className="text-sm text-muted-foreground">{job.employer}</p>
        {job.attribution && <p className="mt-2 text-xs text-brand-700">{job.attribution}</p>}
        {job.applyUrl && (
          <a
            href={job.applyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary mt-4"
          >
            Apply on site
          </a>
        )}
      </div>
      <div className="card">
        <h2 className="font-semibold">Description</h2>
        <pre className="mt-3 whitespace-pre-wrap text-sm text-foreground">{job.description}</pre>
      </div>
    </div>
  );
}
