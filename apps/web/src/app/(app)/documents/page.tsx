'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, Trash2, FileText } from 'lucide-react';
import { api, ApiError, getAccessToken } from '@/lib/api';

interface Doc {
  id: string;
  kind: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  extractionStatus: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'NEEDS_OCR';
  createdAt: string;
}

export default function DocumentsPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: docs, isLoading } = useQuery({
    queryKey: ['documents'],
    queryFn: () => api.get<Doc[]>('/v1/documents'),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.upload<Doc>('/v1/documents', fd);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents'] });
      setError(null);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Upload failed'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/v1/documents/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents'] }),
  });

  async function download(id: string, filename: string) {
    const res = await fetch(`/api/v1/documents/${id}/download`, {
      headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
      credentials: 'include',
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function statusBadge(status: Doc['extractionStatus']) {
    const map = {
      PENDING: 'bg-muted text-muted-foreground',
      PROCESSING: 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300',
      SUCCESS: 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400',
      FAILED: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400',
      NEEDS_OCR: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400',
    } as const;
    return <span className={`rounded px-2 py-0.5 text-xs ${map[status]}`}>{status}</span>;
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Documents</h2>
            <p className="text-sm text-muted-foreground">
              Upload your CV (PDF or DOCX). Max 10 MB.
            </p>
          </div>
          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.doc,.docx,application/pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate(file);
                e.target.value = '';
              }}
            />
            <button
              className="btn-primary"
              onClick={() => fileRef.current?.click()}
              disabled={upload.isPending}
            >
              <Upload className="h-4 w-4" />
              {upload.isPending ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>

      <div className="card p-0">
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        ) : !docs?.length ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            No documents yet. Upload your CV to get started.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-border text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Size</th>
                  <th className="px-4 py-3">Extraction</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td className="px-4 py-3 font-medium">{d.originalName}</td>
                    <td className="px-4 py-3 text-muted-foreground">{d.kind}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {Math.round(d.sizeBytes / 1024)} KB
                    </td>
                    <td className="px-4 py-3">{statusBadge(d.extractionStatus)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => download(d.id, d.originalName)}
                        className="mr-2 inline-flex rounded p-2 text-muted-foreground hover:bg-muted"
                      >
                        ⬇
                      </button>
                      <button
                        onClick={() => remove.mutate(d.id)}
                        className="inline-flex rounded p-2 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
