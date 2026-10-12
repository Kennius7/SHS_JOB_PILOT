'use client';
import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { useOnboarding } from '@/lib/onboarding-context';

export function RulesStep() {
  const { profile, next, back } = useOnboarding();
  const prefs = profile?.preferences ?? {};
  const [excludedCompanies, setExcludedCompanies] = useState((prefs.excludedCompanies ?? []).join(', '));
  const [postedWithin, setPostedWithin] = useState(60);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const hard: any[] = [];
    const soft: any[] = [{ type: 'POSTED_WITHIN_DAYS', days: postedWithin }];
    if (excludedCompanies.trim()) {
      hard.push({ type: 'EMPLOYER_NOT_IN', employers: excludedCompanies.split(',').map((s) => s.trim()).filter(Boolean) });
    }
    await api.post('/v1/rules', {
      name: 'Default rule',
      conditions: { hard, soft: { conditions: soft, minPassRatio: 0.5 }, minMatchScore: prefs.minMatchScore ?? 70 },
    });
    setSaving(false); next();
  }

  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-brand-600" /><h1 className="text-2xl font-semibold">Your first rule</h1></div>
        <p className="mt-2 text-sm text-slate-600">Hard rules reject outright. Soft rules contribute to a match ratio. Refine later.</p>
      </header>
      <div className="card space-y-5">
        <div><label className="label">Excluded companies (hard rule)</label>
          <input value={excludedCompanies} onChange={(e) => setExcludedCompanies(e.target.value)} placeholder="Company A, Company B" className="input" />
        </div>
        <div>
          <label className="label">Only consider jobs posted within: {postedWithin} days</label>
          <input type="range" min={7} max={180} step={7} value={postedWithin} onChange={(e) => setPostedWithin(Number(e.target.value))} className="w-full" />
        </div>
      </div>
      <div className="flex justify-between">
        <button onClick={back} className="btn-secondary">Back</button>
        <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Continue'}</button>
      </div>
    </div>
  );
}
