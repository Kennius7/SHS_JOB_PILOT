'use client';
import { useRef, useState } from 'react';
import { Upload, FileText, SkipForward, Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useOnboarding } from '@/lib/onboarding-context';

export function WelcomeStep() {
  const { next } = useOnboarding();
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'parsing' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File) {
    setError(null);
    setStatus('uploading');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const doc = await api.upload<{ id: string }>('/v1/documents', fd);
      setStatus('parsing');
      await api.post(`/v1/documents/${doc.id}/parse`);
      next();
    } catch (e) {
      setStatus('error');
      setError(e instanceof ApiError ? e.message : 'Something went wrong');
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Welcome to SHS Job Pilot</h1>
        <p className="mt-2 text-sm text-slate-600">
          We'll set up your career profile in under two minutes. Upload your CV and we'll pre-fill
          what we can — you'll review every field before we save it.
        </p>
      </header>
      <div className="card space-y-4">
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.doc,.docx,application/pdf"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={status === 'uploading' || status === 'parsing'}
          className="w-full rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 py-12 hover:border-brand-400 hover:bg-brand-50 disabled:opacity-50"
        >
          {status === 'uploading' || status === 'parsing' ? (
            <>
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-600" />
              <p className="mt-3 text-sm font-medium">
                {status === 'uploading' ? 'Uploading…' : 'Reading your CV…'}
              </p>
            </>
          ) : (
            <>
              <Upload className="mx-auto h-8 w-8 text-slate-400" />
              <p className="mt-3 text-sm font-medium">Upload CV (PDF or DOCX)</p>
              <p className="mt-1 text-xs text-slate-500">Max 10 MB</p>
            </>
          )}
        </button>
        {error && (
          <div className="rounded bg-red-50 p-3 text-sm text-red-700">
            <FileText className="mb-1 inline h-4 w-4" /> {error}
          </div>
        )}
        <div className="flex items-center justify-between border-t border-slate-200 pt-4">
          <p className="text-xs text-slate-500">
            No CV handy? You can fill everything in manually.
          </p>
          <button onClick={next} className="btn-secondary">
            <SkipForward className="h-4 w-4" /> Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}
