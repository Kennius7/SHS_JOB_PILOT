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
      PENDING: 'bg-slate-100 text-slate-600',
      PROCESSING: 'bg-blue-100 text-blue-700',
      SUCCESS: 'bg-green-100 text-green-700',
      FAILED: 'bg-red-100 text-red-700',
      NEEDS_OCR: 'bg-amber-100 text-amber-700',
    } as const;
    return <span className={`rounded px-2 py-0.5 text-xs ${map[status]}`}>{status}</span>;
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Documents</h2>
            <p className="text-sm text-slate-600">Upload your CV (PDF or DOCX). Max 10 MB.</p>
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
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>

      <div className="card p-0">
        {isLoading ? (
          <div className="p-6 text-sm text-slate-500">Loading…</div>
        ) : !docs?.length ? (
          <div className="p-12 text-center text-sm text-slate-500">
            <FileText className="mx-auto mb-3 h-8 w-8 text-slate-300" />
            No documents yet. Upload your CV to get started.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Size</th>
                <th className="px-4 py-3">Extraction</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {docs.map((d) => (
                <tr key={d.id}>
                  <td className="px-4 py-3 font-medium">{d.originalName}</td>
                  <td className="px-4 py-3 text-slate-600">{d.kind}</td>
                  <td className="px-4 py-3 text-slate-600">{Math.round(d.sizeBytes / 1024)} KB</td>
                  <td className="px-4 py-3">{statusBadge(d.extractionStatus)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => download(d.id, d.originalName)}
                      className="mr-2 inline-flex rounded p-2 text-slate-500 hover:bg-slate-100"
                    >
                      ⬇
                    </button>
                    <button
                      onClick={() => remove.mutate(d.id)}
                      className="inline-flex rounded p-2 text-red-500 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
