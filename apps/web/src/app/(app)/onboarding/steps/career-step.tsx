'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Plus, X } from 'lucide-react';
import { useOnboarding } from '@/lib/onboarding-context';

export function CareerStep() {
  const { profile, next, back, saveStep } = useOnboarding();
  const [roles, setRoles] = useState<string[]>(profile?.targetRoles ?? []);
  const [roleInput, setRoleInput] = useState('');
  const { register, handleSubmit } = useForm({
    defaultValues: {
      currentRole: profile?.currentRole ?? '',
      yearsExperience: profile?.yearsExperience ?? 0,
      summary: profile?.summary ?? '',
      noticePeriod: profile?.noticePeriod ?? '',
    },
  });
  const [saving, setSaving] = useState(false);

  return (
    <form onSubmit={handleSubmit(async (v) => {
      if (!roles.length) return;
      setSaving(true); await saveStep({ ...v, targetRoles: roles }); setSaving(false); next();
    })} className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">What are you looking for?</h1>
        <p className="mt-2 text-sm text-slate-600">Target roles drive the rules engine.</p>
      </header>
      <div className="card space-y-4">
        <div><label className="label">Current role</label><input {...register('currentRole')} className="input" /></div>
        <div>
          <label className="label">Target roles *</label>
          <div className="flex gap-2">
            <input value={roleInput} onChange={(e) => setRoleInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const r = roleInput.trim(); if (r && !roles.includes(r)) { setRoles([...roles, r]); setRoleInput(''); } } }}
              placeholder="Backend Engineer" className="input" />
            <button type="button" onClick={() => { const r = roleInput.trim(); if (r && !roles.includes(r)) { setRoles([...roles, r]); setRoleInput(''); } }} className="btn-secondary">
              <Plus className="h-4 w-4" />
            </button>
          </div>
          {roles.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {roles.map((r) => (
                <span key={r} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs text-brand-700">
                  {r}<button type="button" onClick={() => setRoles(roles.filter((x) => x !== r))}><X className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
          )}
        </div>
        <div><label className="label">Years of experience</label><input type="number" min={0} max={60} {...register('yearsExperience', { valueAsNumber: true })} className="input max-w-[120px]" /></div>
        <div><label className="label">Notice period</label><input {...register('noticePeriod')} className="input" /></div>
        <div><label className="label">Summary</label><textarea {...register('summary')} rows={3} className="input" /></div>
      </div>
      <div className="flex justify-between">
        <button type="button" onClick={back} className="btn-secondary">Back</button>
        <button type="submit" disabled={saving || !roles.length} className="btn-primary">{saving ? 'Saving…' : 'Continue'}</button>
      </div>
    </form>
  );
}
