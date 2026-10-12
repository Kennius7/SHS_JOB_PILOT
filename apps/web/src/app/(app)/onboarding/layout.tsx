'use client';

import { OnboardingProvider, useOnboarding, STEPS } from '@/lib/onboarding-context';
import { Check } from 'lucide-react';

const LABELS: Record<string, string> = {
  welcome: 'Welcome', 'review-cv': 'Review CV', contact: 'Contact',
  career: 'Career', skills: 'Skills', preferences: 'Preferences',
  rules: 'Rules', done: 'Done',
};

function Progress() {
  const { stepIndex } = useOnboarding();
  const visible = STEPS.filter((s) => s !== 'done');
  return (
    <ol className="flex items-center justify-between">
      {visible.map((s, i) => {
        const done = i < stepIndex;
        const active = i === stepIndex;
        return (
          <li key={s} className="flex flex-1 items-center">
            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
              done ? 'bg-brand-600 text-white' : active ? 'bg-brand-100 text-brand-700 ring-2 ring-brand-500' : 'bg-slate-100 text-slate-500'
            }`}>
              {done ? <Check className="h-4 w-4" /> : i + 1}
            </div>
            <span className={`ml-2 hidden text-xs md:inline ${active ? 'font-medium text-slate-900' : 'text-slate-500'}`}>{LABELS[s]}</span>
            {i < visible.length - 1 && <div className={`mx-3 hidden flex-1 border-t md:block ${done ? 'border-brand-500' : 'border-slate-200'}`} />}
          </li>
        );
      })}
    </ol>
  );
}

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <OnboardingProvider>
      <div className="mx-auto max-w-2xl px-4 py-10">
        <Progress />
        <div className="mt-8">{children}</div>
      </div>
    </OnboardingProvider>
  );
}
