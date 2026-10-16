'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Briefcase, ListChecks, CheckCircle2, AlertCircle, FileText } from 'lucide-react';
import { api } from '@/lib/api';

export default function DashboardPage() {
  const { data: apps } = useQuery({
    queryKey: ['applications', 'summary'],
    queryFn: () => api.get<any[]>('/v1/applications'),
  });

  const counts = (apps ?? []).reduce((acc: any, a: any) => {
    acc[a.state] = (acc[a.state] ?? 0) + 1;
    return acc;
  }, {});

  const cards = [
    { key: 'MATCHED', label: 'Matched', icon: Briefcase, tone: 'text-brand-600' },
    {
      key: 'AWAITING_APPROVAL',
      label: 'Awaiting approval',
      icon: AlertCircle,
      tone: 'text-amber-600 dark:text-amber-400',
    },
    { key: 'SUBMITTED', label: 'Submitted', icon: ListChecks, tone: 'text-muted-foreground' },
    {
      key: 'CONFIRMED',
      label: 'Confirmed',
      icon: CheckCircle2,
      tone: 'text-green-600 dark:text-green-400',
    },
    { key: 'FAILED', label: 'Failed', icon: AlertCircle, tone: 'text-red-600 dark:text-red-400' },
    { key: 'DISCOVERED', label: 'Discovered', icon: FileText, tone: 'text-muted-foreground' },
  ] as const;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        <Link href="/jobs" className="btn-primary">
          Browse jobs
        </Link>
        <Link href="/rules" className="btn-secondary">
          Edit rules
        </Link>
        <Link href="/documents" className="btn-secondary">
          Upload CV
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        {cards.map(({ key, label, icon: Icon, tone }) => (
          <div key={key} className="card">
            <Icon className={`h-5 w-5 ${tone}`} />
            <div className="mt-2 text-2xl font-semibold">{counts[key] ?? 0}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold">Getting started</h2>
        <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
          <li>1. Upload your CV and confirm the parsed profile.</li>
          <li>2. Set target roles, states, and salary preferences.</li>
          <li>3. Define application rules and simulate against existing jobs.</li>
          <li>4. Enable approval-required mode before automatic submission.</li>
        </ol>
      </div>
    </div>
  );
}
