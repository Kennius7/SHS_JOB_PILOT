'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, Save, Plus, Trash2, ShieldAlert, ShieldCheck, Info } from 'lucide-react';
import { api } from '@/lib/api';

const EMPTY = {
  hard: [] as any[],
  soft: { conditions: [] as any[], minPassRatio: 0.5 },
  minMatchScore: 70,
};

export default function RulesPage() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<any>(EMPTY);
  const [name, setName] = useState('My rule set');
  const [simulation, setSimulation] = useState<any>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const { data: active } = useQuery({
    queryKey: ['rules', 'active'],
    queryFn: () => api.get<any>('/v1/rules/active'),
  });

  useEffect(() => {
    if (active?.conditions) {
      setDraft({ ...EMPTY, ...active.conditions });
      setName(active.name ?? 'My rule set');
    }
  }, [active]);

  const save = useMutation({
    mutationFn: () => active?.id
      ? api.patch(`/v1/rules/${active.id}`, { name, conditions: draft })
      : api.post('/v1/rules', { name, conditions: draft }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rules'] }); setSavedAt(new Date()); },
  });

  const simulate = useMutation({
    mutationFn: () => api.post<any>('/v1/rules/simulate', { conditions: draft }),
    onSuccess: (data) => setSimulation(data),
  });

  function addCondition(slot: 'hard' | 'soft') {
    const c = { type: 'STATE_IN', states: ['LAGOS'] };
    if (slot === 'hard') setDraft({ ...draft, hard: [...draft.hard, c] });
    else setDraft({ ...draft, soft: { ...draft.soft, conditions: [...draft.soft.conditions, c] } });
  }

  function removeCondition(slot: 'hard' | 'soft', i: number) {
    if (slot === 'hard') setDraft({ ...draft, hard: draft.hard.filter((_: any, j: number) => j !== i) });
    else setDraft({ ...draft, soft: { ...draft.soft, conditions: draft.soft.conditions.filter((_: any, j: number) => j !== i) } });
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <label className="label">Rule name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input max-w-sm" />
          </div>
          <div className="flex gap-2 pt-6">
            <button onClick={() => simulate.mutate()} disabled={simulate.isPending} className="btn-secondary">
              <Play className="h-4 w-4" /> {simulate.isPending ? 'Simulating…' : 'Simulate'}
            </button>
            <button onClick={() => save.mutate()} disabled={save.isPending} className="btn-primary">
              <Save className="h-4 w-4" /> {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
        {savedAt && <p className="mt-2 text-xs text-green-600">Saved at {savedAt.toLocaleTimeString()}</p>}
      </div>

      <div className="card space-y-3">
        <div className="flex items-start gap-3">
          <ShieldAlert className="h-5 w-5 text-red-500" />
          <div>
            <h2 className="font-semibold">Hard rules</h2>
            <p className="text-sm text-slate-600">A single failure rejects the job outright. AI scores cannot override these.</p>
          </div>
        </div>
        {draft.hard.map((c: any, i: number) => (
          <ConditionRow key={i} condition={c} onChange={(next) => {
            const copy = [...draft.hard]; copy[i] = next; setDraft({ ...draft, hard: copy });
          }} onRemove={() => removeCondition('hard', i)} />
        ))}
        <button onClick={() => addCondition('hard')} className="btn-secondary">
          <Plus className="h-4 w-4" /> Add hard condition
        </button>
      </div>

      <div className="card space-y-3">
        <div className="flex items-start gap-3">
          <ShieldCheck className="h-5 w-5 text-green-500" />
          <div>
            <h2 className="font-semibold">Soft rules</h2>
            <p className="text-sm text-slate-600">Contribute to a pass ratio. Below the ratio → job moves to REVIEW.</p>
          </div>
        </div>
        <div>
          <label className="label">Minimum pass ratio: {(draft.soft.minPassRatio * 100).toFixed(0)}%</label>
          <input
            type="range" min={0} max={1} step={0.05}
            value={draft.soft.minPassRatio}
            onChange={(e) => setDraft({ ...draft, soft: { ...draft.soft, minPassRatio: Number(e.target.value) } })}
            className="w-full max-w-md"
          />
        </div>
        {draft.soft.conditions.map((c: any, i: number) => (
          <ConditionRow key={i} condition={c} onChange={(next) => {
            const copy = [...draft.soft.conditions]; copy[i] = next;
            setDraft({ ...draft, soft: { ...draft.soft, conditions: copy } });
          }} onRemove={() => removeCondition('soft', i)} />
        ))}
        <button onClick={() => addCondition('soft')} className="btn-secondary">
          <Plus className="h-4 w-4" /> Add soft condition
        </button>
      </div>

      <div className="card">
        <label className="label">Minimum AI match score: {draft.minMatchScore}</label>
        <input
          type="range" min={0} max={100}
          value={draft.minMatchScore}
          onChange={(e) => setDraft({ ...draft, minMatchScore: Number(e.target.value) })}
          className="w-full max-w-md"
        />
      </div>

      {simulation && (
        <div className="card space-y-3">
          <div className="flex items-center gap-3">
            <Info className="h-5 w-5 text-brand-600" />
            <h2 className="font-semibold">Simulation results</h2>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Evaluated" value={simulation.evaluated} />
            <Stat label="Eligible" value={simulation.eligible} tone="text-green-600" />
            <Stat label="Review" value={simulation.review} tone="text-amber-600" />
            <Stat label="Ineligible" value={simulation.ineligible} tone="text-red-600" />
          </div>
        </div>
      )}

      <details className="card">
        <summary className="cursor-pointer text-sm font-medium">Raw JSON (advanced)</summary>
        <pre className="mt-3 max-h-96 overflow-auto rounded bg-slate-50 p-3 text-xs">{JSON.stringify(draft, null, 2)}</pre>
      </details>
    </div>
  );
}

function ConditionRow({ condition, onChange, onRemove }: { condition: any; onChange: (c: any) => void; onRemove: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <select
        value={condition.type}
        onChange={(e) => onChange(defaultFor(e.target.value))}
        className="input max-w-xs"
      >
        <option value="STATE_IN">State is one of</option>
        <option value="WORK_ARRANGEMENT_IN">Work arrangement is one of</option>
        <option value="EMPLOYER_NOT_IN">Employer not in list</option>
        <option value="TITLE_MATCHES">Title matches</option>
        <option value="SALARY_MIN_AT_LEAST">Salary at least</option>
        <option value="POSTED_WITHIN_DAYS">Posted within days</option>
        <option value="DESCRIPTION_NOT_CONTAINS">Description not contains</option>
      </select>
      <div className="flex-1">
        {condition.type === 'STATE_IN' && (
          <input
            value={(condition.states ?? []).join(', ')}
            onChange={(e) => onChange({ ...condition, states: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
            placeholder="LAGOS, FCT"
            className="input"
          />
        )}
        {condition.type === 'EMPLOYER_NOT_IN' && (
          <input
            value={(condition.employers ?? []).join(', ')}
            onChange={(e) => onChange({ ...condition, employers: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
            className="input"
          />
        )}
        {condition.type === 'WORK_ARRANGEMENT_IN' && (
          <input
            value={(condition.values ?? []).join(', ')}
            onChange={(e) => onChange({ ...condition, values: e.target.value.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) })}
            placeholder="REMOTE, HYBRID"
            className="input"
          />
        )}
        {condition.type === 'TITLE_MATCHES' && (
          <input
            value={(condition.patterns ?? []).join(', ')}
            onChange={(e) => onChange({ ...condition, patterns: e.target.value.split(',').map((s) => s.trim()).filter(Boolean), mode: 'any', caseSensitive: false })}
            placeholder="engineer, developer"
            className="input"
          />
        )}
        {condition.type === 'SALARY_MIN_AT_LEAST' && (
          <div className="flex gap-2">
            <input
              type="number"
              value={condition.amount ?? 0}
              onChange={(e) => onChange({ ...condition, amount: Number(e.target.value), currency: 'NGN', allowMissing: true })}
              className="input max-w-[160px]"
            />
            <span className="self-center text-xs text-slate-500">NGN / year</span>
          </div>
        )}
        {condition.type === 'POSTED_WITHIN_DAYS' && (
          <input
            type="number"
            value={condition.days ?? 30}
            onChange={(e) => onChange({ ...condition, days: Number(e.target.value) })}
            className="input max-w-[120px]"
          />
        )}
        {condition.type === 'DESCRIPTION_NOT_CONTAINS' && (
          <input
            value={(condition.terms ?? []).join(', ')}
            onChange={(e) => onChange({ ...condition, terms: e.target.value.split(',').map((s) => s.trim()).filter(Boolean), caseSensitive: false })}
            className="input"
          />
        )}
      </div>
      <button onClick={onRemove} className="rounded p-2 text-red-500 hover:bg-red-50">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function Stat({ label, value, tone = 'text-slate-900' }: { label: string; value: number; tone?: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-xl font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

function defaultFor(type: string): any {
  switch (type) {
    case 'STATE_IN': return { type, states: ['LAGOS'] };
    case 'EMPLOYER_NOT_IN': return { type, employers: [] };
    case 'WORK_ARRANGEMENT_IN': return { type, values: ['REMOTE'] };
    case 'TITLE_MATCHES': return { type, patterns: [], mode: 'any', caseSensitive: false };
    case 'SALARY_MIN_AT_LEAST': return { type, amount: 0, currency: 'NGN', allowMissing: true };
    case 'POSTED_WITHIN_DAYS': return { type, days: 30 };
    case 'DESCRIPTION_NOT_CONTAINS': return { type, terms: [], caseSensitive: false };
    default: return { type };
  }
}
