'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useOnboarding } from '@/lib/onboarding-context';
import { NIGERIAN_STATES } from '@/lib/constants';

export function ContactStep() {
  const { profile, next, back, saveStep } = useOnboarding();
  const { register, handleSubmit } = useForm({
    defaultValues: {
      fullName: profile?.fullName ?? '',
      phone: profile?.phone ?? '',
      country: profile?.country ?? 'NG',
      state: profile?.state ?? 'LAGOS',
      city: profile?.city ?? '',
      workAuthorized: profile?.workAuthorized ?? true,
      needsSponsorship: profile?.needsSponsorship ?? false,
    },
  });
  const [saving, setSaving] = useState(false);

  return (
    <form
      onSubmit={handleSubmit(async (v) => {
        setSaving(true);
        await saveStep(v);
        setSaving(false);
        next();
      })}
      className="space-y-6"
    >
      <header>
        <h1 className="text-2xl font-semibold">Where are you based?</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Used to filter jobs and flag sponsorship requirements.
        </p>
      </header>
      <div className="card space-y-4">
        <div>
          <label className="label">Full name</label>
          <input {...register('fullName')} className="input" />
        </div>
        <div>
          <label className="label">Phone</label>
          <input {...register('phone')} className="input" placeholder="+234…" />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className="label">Country</label>
            <input {...register('country')} className="input" />
          </div>
          <div>
            <label className="label">State</label>
            <select {...register('state')} className="input">
              {NIGERIAN_STATES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">City</label>
            <input {...register('city')} className="input" />
          </div>
        </div>
        <div className="flex gap-6 border-t border-border pt-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...register('workAuthorized')} /> Work authorized
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...register('needsSponsorship')} /> Needs sponsorship
          </label>
        </div>
      </div>
      <div className="flex justify-between">
        <button type="button" onClick={back} className="btn-secondary">
          Back
        </button>
        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? 'Saving…' : 'Continue'}
        </button>
      </div>
    </form>
  );
}
