'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, RefreshCw, Search } from 'lucide-react';
import { api } from '@/lib/api';

interface RedisKeyInfo {
  key: string;
  type: string;
  ttl: number;
}
interface RedisKeysResponse {
  cursor: string;
  keys: RedisKeyInfo[];
  done: boolean;
}
interface RedisKeyDetail {
  key: string;
  type: string;
  ttl: number;
  size: number;
  value: unknown;
  truncated: boolean;
}

const TYPE_COLORS: Record<string, string> = {
  string: 'bg-blue-100 dark:bg-blue-500/20 text-blue-800 dark:text-blue-300',
  list: 'bg-green-100 dark:bg-green-500/20 text-green-800 dark:text-green-300',
  set: 'bg-purple-100 dark:bg-purple-500/20 text-purple-800 dark:text-purple-300',
  zset: 'bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300',
  hash: 'bg-pink-100 dark:bg-pink-500/20 text-pink-800 dark:text-pink-300',
  stream: 'bg-cyan-100 dark:bg-cyan-500/20 text-cyan-800 dark:text-cyan-300',
  none: 'bg-muted text-muted-foreground',
};

function ttlLabel(ttl: number) {
  if (ttl === -1) return 'no expiry';
  if (ttl === -2) return 'missing';
  return `${ttl}s`;
}

function ValueView({ detail }: { detail: RedisKeyDetail }) {
  const { type, value } = detail;
  if (value === null || value === undefined) {
    return <p className="text-sm text-muted-foreground">No value.</p>;
  }
  if (type === 'string') {
    return (
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-background p-3 text-xs text-foreground">
        {String(value)}
      </pre>
    );
  }
  if (type === 'hash') {
    const entries = Object.entries(value as Record<string, string>);
    return (
      <table className="w-full text-sm">
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k} className="border-b border-border last:border-0 align-top">
              <td className="w-1/3 py-1.5 pr-3 font-medium text-foreground">{k}</td>
              <td className="break-all py-1.5 text-muted-foreground">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (type === 'zset') {
    const entries = value as { member: string; score: string }[];
    return (
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
            <th className="py-1.5 pr-3 font-medium">Member</th>
            <th className="py-1.5 font-medium">Score</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={i} className="border-b border-border last:border-0">
              <td className="break-all py-1.5 pr-3 text-foreground">{e.member}</td>
              <td className="py-1.5 text-muted-foreground">{e.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (Array.isArray(value)) {
    return (
      <ol className="max-h-64 space-y-1 overflow-auto rounded-lg border border-border bg-background p-3">
        {value.map((v, i) => (
          <li key={i} className="flex gap-2 text-xs text-foreground">
            <span className="shrink-0 text-muted-foreground">{i}</span>
            <span className="break-all">{typeof v === 'string' ? v : JSON.stringify(v)}</span>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-background p-3 text-xs text-foreground">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function RedisExplorer() {
  const [patternInput, setPatternInput] = useState('*');
  const [pattern, setPattern] = useState('*');
  const [selected, setSelected] = useState<string | null>(null);

  const keys = useQuery({
    queryKey: ['admin-redis-keys', pattern],
    queryFn: () =>
      api.get<RedisKeysResponse>(
        `/v1/admin/redis/keys?pattern=${encodeURIComponent(pattern)}&limit=100`,
      ),
  });

  const detail = useQuery({
    queryKey: ['admin-redis-key', selected],
    queryFn: () =>
      api.get<RedisKeyDetail>(`/v1/admin/redis/key?key=${encodeURIComponent(selected!)}`),
    enabled: !!selected,
  });

  return (
    <section className="card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-medium text-foreground">
          <KeyRound className="h-4 w-4" /> Redis keys
        </div>
        <button onClick={() => keys.refetch()} className="btn-secondary">
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPattern(patternInput.trim() || '*');
          setSelected(null);
        }}
        className="mb-3 flex items-center gap-2"
      >
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={patternInput}
            onChange={(e) => setPatternInput(e.target.value)}
            placeholder="Pattern, e.g. bull:*"
            className="input w-64 py-1.5 pl-7 text-sm"
          />
        </div>
        <button type="submit" className="btn-secondary">
          Scan
        </button>
        <span className="ml-auto text-xs text-muted-foreground">
          {keys.data ? `${keys.data.keys.length} key(s)` : ''}
        </span>
      </form>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="max-h-[420px] overflow-y-auto rounded-lg border border-border">
          {keys.isLoading ? (
            <p className="p-3 text-sm text-muted-foreground">Loading…</p>
          ) : keys.isError ? (
            <p className="p-3 text-sm text-red-600 dark:text-red-400">
              {(keys.error as Error).message}
            </p>
          ) : !keys.data?.keys?.length ? (
            <p className="p-3 text-sm text-muted-foreground">No keys match this pattern.</p>
          ) : (
            <ul className="divide-y divide-border">
              {keys.data.keys.map((k) => (
                <li key={k.key}>
                  <button
                    onClick={() => setSelected(k.key)}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted ${
                      selected === k.key ? 'bg-brand-50' : ''
                    }`}
                  >
                    <span className="truncate font-mono text-xs text-foreground">{k.key}</span>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        TYPE_COLORS[k.type] ?? TYPE_COLORS.none
                      }`}
                    >
                      {k.type}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="min-w-0">
          {!selected ? (
            <p className="text-sm text-muted-foreground">Select a key to inspect its value.</p>
          ) : detail.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : detail.isError ? (
            <p className="text-sm text-red-600 dark:text-red-400">
              {(detail.error as Error).message}
            </p>
          ) : detail.data ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <code className="break-all font-mono text-xs text-foreground">
                  {detail.data.key}
                </code>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    TYPE_COLORS[detail.data.type] ?? TYPE_COLORS.none
                  }`}
                >
                  {detail.data.type}
                </span>
                <span className="text-xs text-muted-foreground">
                  ttl: {ttlLabel(detail.data.ttl)}
                </span>
                {detail.data.size > 0 && (
                  <span className="text-xs text-muted-foreground">size: {detail.data.size}</span>
                )}
                {detail.data.truncated && (
                  <span className="text-xs text-amber-600 dark:text-amber-400">
                    truncated (first 200)
                  </span>
                )}
              </div>
              <ValueView detail={detail.data} />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
