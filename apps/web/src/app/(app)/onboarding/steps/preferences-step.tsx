'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useOnboarding } from '@/lib/onboarding-context';

export function PreferencesStep() {
  const { profile, next, back } = useOnboarding();
  const prefs = profile?.preferences ?? {};
  const [preferredStates, setPreferredStates] = useState<string[]>(
    prefs.preferredStates ?? ['LAGOS'],
  );
  const [remoteOnly, setRemoteOnly] = useState(prefs.remoteOnly ?? false);
  const [salaryFloor, setSalaryFloor] = useState<number | ''>(prefs.salaryFloor ?? '');
  const [employmentTypes, setEmploymentTypes] = useState<string[]>(
    prefs.employmentTypes ?? ['FULL_TIME'],
  );
  const [excludedCompanies, setExcludedCompanies] = useState(
    (prefs.excludedCompanies ?? []).join(', '),
  );
  const [maxPerDay, setMaxPerDay] = useState(prefs.maxApplicationsPerDay ?? 10);
  const [minMatchScore, setMinMatchScore] = useState(prefs.minMatchScore ?? 70);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await api.patch('/v1/profile/preferences', {
      preferredStates,
      remoteOnly,
      salaryFloor: salaryFloor === '' ? undefined : Number(salaryFloor),
      salaryCurrency: 'NGN',
      employmentTypes,
      excludedCompanies: excludedCompanies
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean),
      maxApplicationsPerDay: maxPerDay,
      minMatchScore,
    });
    setSaving(false);
    next();
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Preferences</h1>
        <p className="mt-2 text-sm text-slate-600">These shape which jobs get matched.</p>
      </header>
      <div className="card space-y-5">
        <div>
          <label className="label">Preferred states</label>
          <div className="grid grid-cols-3 gap-2">
            {['LAGOS', 'FCT', 'RIVERS', 'KANO', 'OYO', 'KADUNA'].map((s) => (
              <label key={s} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={preferredStates.includes(s)}
                  onChange={(e) =>
                    setPreferredStates(
                      e.target.checked
                        ? [...preferredStates, s]
                        : preferredStates.filter((x) => x !== s),
                    )
                  }
                />
                {s.replace(/_/g, ' ')}
              </label>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={remoteOnly}
            onChange={(e) => setRemoteOnly(e.target.checked)}
          />{' '}
          Remote roles only
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="label">Salary floor (NGN)</label>
            <input
              type="number"
              value={salaryFloor}
              onChange={(e) => setSalaryFloor(e.target.value === '' ? '' : Number(e.target.value))}
              className="input"
            />
          </div>
          <div>
            <label className="label">Max applications/day</label>
            <input
              type="number"
              min={1}
              max={100}
              value={maxPerDay}
              onChange={(e) => setMaxPerDay(Number(e.target.value))}
              className="input"
            />
          </div>
        </div>
        <div>
          <label className="label">Employment types</label>
          <div className="flex flex-wrap gap-3">
            {['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP'].map((t) => (
              <label key={t} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={employmentTypes.includes(t)}
                  onChange={(e) =>
                    setEmploymentTypes(
                      e.target.checked
                        ? [...employmentTypes, t]
                        : employmentTypes.filter((x) => x !== t),
                    )
                  }
                />
                {t.replace('_', ' ')}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className="label">Excluded companies</label>
          <input
            value={excludedCompanies}
            onChange={(e) => setExcludedCompanies(e.target.value)}
            className="input"
          />
        </div>
        <div>
          <label className="label">Minimum match score: {minMatchScore}</label>
          <input
            type="range"
            min={0}
            max={100}
            value={minMatchScore}
            onChange={(e) => setMinMatchScore(Number(e.target.value))}
            className="w-full"
          />
        </div>
      </div>
      <div className="flex justify-between">
        <button onClick={back} className="btn-secondary">
          Back
        </button>
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? 'Saving…' : 'Continue'}
        </button>
      </div>
    </div>
  );
}
