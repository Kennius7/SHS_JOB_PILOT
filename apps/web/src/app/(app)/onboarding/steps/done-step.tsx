'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Briefcase } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

export function DoneStep() {
  const router = useRouter();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function finish() {
    setSaving(true); setError(null);
    try {
      await api.post('/v1/profile/complete-onboarding');
      await qc.invalidateQueries({ queryKey: ['profile'] });
      router.replace('/dashboard');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong');
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
        <CheckCircle2 className="h-8 w-8 text-green-600" />
      </div>
      <h1 className="text-2xl font-semibold">You're set up</h1>
      <p className="mt-2 text-sm text-slate-600">From now on, we'll match new jobs against your profile and rules.</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button onClick={finish} disabled={saving} className="btn-primary mx-auto">
        <Briefcase className="h-4 w-4" /> {saving ? 'Finishing…' : 'Go to dashboard'}
      </button>
    </div>
  );
}
