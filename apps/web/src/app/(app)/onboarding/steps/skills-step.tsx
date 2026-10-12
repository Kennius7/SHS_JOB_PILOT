'use client';
import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useOnboarding } from '@/lib/onboarding-context';

export function SkillsStep() {
  const { profile, next, back } = useOnboarding();
  const [skills, setSkills] = useState<any[]>(
    (profile?.skills ?? []).map((s: any) => ({ name: s.skill.name, level: s.level ?? undefined })),
  );
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);

  function add() {
    const n = input.trim();
    if (!n || skills.some((s) => s.name.toLowerCase() === n.toLowerCase())) return;
    setSkills([...skills, { name: n }]); setInput('');
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Your skills</h1>
        <p className="mt-2 text-sm text-slate-600">Used by the match engine.</p>
      </header>
      <div className="card space-y-4">
        <div className="flex gap-2">
          <input value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            placeholder="e.g. TypeScript" className="input" />
          <button type="button" onClick={add} className="btn-secondary"><Plus className="h-4 w-4" /></button>
        </div>
        {skills.length === 0 ? (
          <p className="text-sm text-slate-500">Add at least one skill.</p>
        ) : (
          <ul className="space-y-2">
            {skills.map((s, i) => (
              <li key={i} className="flex items-center gap-2 rounded border border-slate-200 p-2">
                <span className="flex-1 text-sm font-medium">{s.name}</span>
                <select value={s.level ?? ''} onChange={(e) => {
                  const copy = [...skills]; copy[i] = { ...s, level: e.target.value ? Number(e.target.value) : undefined }; setSkills(copy);
                }} className="input max-w-[100px] py-1 text-xs">
                  <option value="">Level</option>
                  {[1, 2, 3, 4, 5].map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
                <button onClick={() => setSkills(skills.filter((_, j) => j !== i))} className="rounded p-1 text-red-500 hover:bg-red-50">
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex justify-between">
        <button onClick={back} className="btn-secondary">Back</button>
        <button onClick={async () => { if (!skills.length) return; setSaving(true); await api.post('/v1/profile/skills', { skills }); setSaving(false); next(); }}
          disabled={saving || !skills.length} className="btn-primary">
          {saving ? 'Saving…' : 'Continue'}
        </button>
      </div>
    </div>
  );
}
