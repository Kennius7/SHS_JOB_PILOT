'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Database, RefreshCw, Search, Table2 } from 'lucide-react';
import { api } from '@/lib/api';

interface TableInfo {
  name: string;
  rows: number;
}
interface ColumnMeta {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
}
interface RowsResponse {
  table: string;
  columns: ColumnMeta[];
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  limit: number;
  orderBy: string | null;
  order: 'asc' | 'desc';
}

const PAGE_SIZE = 50;

function Cell({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-slate-300">NULL</span>;
  }
  if (typeof value === 'object') {
    return <code className="text-xs text-slate-600">{JSON.stringify(value)}</code>;
  }
  const text = String(value);
  return (
    <span className="whitespace-nowrap" title={text.length > 60 ? text : undefined}>
      {text.length > 60 ? `${text.slice(0, 60)}…` : text}
    </span>
  );
}

export function DbExplorer() {
  const [table, setTable] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [orderBy, setOrderBy] = useState<string | null>(null);
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  const tables = useQuery({
    queryKey: ['admin-db-tables'],
    queryFn: () => api.get<{ tables: TableInfo[] }>('/v1/admin/db/tables'),
  });

  const rows = useQuery({
    queryKey: ['admin-db-rows', table, page, orderBy, order, search],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (orderBy) {
        params.set('orderBy', orderBy);
        params.set('order', order);
      }
      if (search) params.set('q', search);
      return api.get<RowsResponse>(
        `/v1/admin/db/tables/${encodeURIComponent(table!)}/rows?${params.toString()}`,
      );
    },
    enabled: !!table,
  });

  const selectTable = (name: string) => {
    setTable(name);
    setPage(1);
    setOrderBy(null);
    setOrder('asc');
    setSearch('');
    setSearchInput('');
  };

  const sortBy = (column: string) => {
    if (orderBy === column) {
      setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setOrderBy(column);
      setOrder('asc');
    }
    setPage(1);
  };

  const totalPages = rows.data ? Math.max(1, Math.ceil(rows.data.total / rows.data.limit)) : 1;

  return (
    <section className="card">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 font-medium text-slate-900">
          <Database className="h-4 w-4" /> Database (PostgreSQL)
        </div>
        <button onClick={() => tables.refetch()} className="btn-secondary">
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <div className="max-h-[420px] overflow-y-auto rounded-lg border border-slate-200">
          {tables.isLoading ? (
            <p className="p-3 text-sm text-slate-500">Loading…</p>
          ) : !tables.data?.tables?.length ? (
            <p className="p-3 text-sm text-slate-500">No tables found.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {tables.data.tables.map((t) => (
                <li key={t.name}>
                  <button
                    onClick={() => selectTable(t.name)}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                      table === t.name ? 'bg-brand-50 text-brand-700' : 'text-slate-700'
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <Table2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span className="truncate">{t.name}</span>
                    </span>
                    <span className="shrink-0 text-xs text-slate-400">{t.rows}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="min-w-0">
          {!table ? (
            <p className="text-sm text-slate-500">Select a table to browse its rows.</p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    setSearch(searchInput.trim());
                    setPage(1);
                  }}
                  className="flex items-center gap-2"
                >
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      placeholder="Search all columns…"
                      className="input w-64 py-1.5 pl-7 text-sm"
                    />
                  </div>
                  <button type="submit" className="btn-secondary">
                    Search
                  </button>
                  {(search || searchInput) && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearch('');
                        setSearchInput('');
                        setPage(1);
                      }}
                      className="text-xs text-slate-500 hover:text-slate-700"
                    >
                      Clear
                    </button>
                  )}
                </form>
                <span className="ml-auto text-xs text-slate-500">
                  {rows.data ? `${rows.data.total} row(s)` : ''}
                </span>
              </div>

              {rows.isLoading ? (
                <p className="text-sm text-slate-500">Loading…</p>
              ) : rows.isError ? (
                <p className="text-sm text-red-600">{(rows.error as Error).message}</p>
              ) : !rows.data?.rows?.length ? (
                <p className="text-sm text-slate-500">No rows.</p>
              ) : (
                <div className="max-h-[420px] overflow-auto rounded-lg border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50">
                      <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                        {rows.data.columns.map((c) => (
                          <th key={c.name} className="whitespace-nowrap px-3 py-2 font-medium">
                            <button
                              onClick={() => sortBy(c.name)}
                              className="inline-flex items-center gap-1 hover:text-slate-800"
                              title={c.dataType}
                            >
                              {c.name}
                              {c.isPrimaryKey && <span className="text-amber-500">•</span>}
                              {rows.data.orderBy === c.name && (
                                <span className="text-brand-600">
                                  {rows.data.order === 'asc' ? '↑' : '↓'}
                                </span>
                              )}
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.data.rows.map((row, i) => (
                        <tr
                          key={i}
                          className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
                        >
                          {rows.data.columns.map((c) => (
                            <td key={c.name} className="max-w-xs truncate px-3 py-2 text-slate-700">
                              <Cell value={row[c.name]} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {rows.data && rows.data.total > rows.data.limit && (
                <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                  <span>
                    Page {rows.data.page} of {totalPages}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={rows.data.page <= 1}
                      className="btn-secondary"
                    >
                      Prev
                    </button>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={rows.data.page >= totalPages}
                      className="btn-secondary"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
