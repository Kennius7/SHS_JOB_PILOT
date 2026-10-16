'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export const STEPS = [
  'welcome',
  'review-cv',
  'contact',
  'career',
  'skills',
  'preferences',
  'rules',
  'done',
] as const;
export type Step = (typeof STEPS)[number];

interface Ctx {
  step: Step;
  stepIndex: number;
  goTo: (s: Step) => void;
  next: () => void;
  back: () => void;
  profile: any;
  isLoading: boolean;
  saveStep: <T>(patch: T, endpoint?: string) => Promise<void>;
}

const OnboardingCtx = createContext<Ctx | null>(null);

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const { data: profile, isLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get<any>('/v1/profile'),
  });
  const [step, setStep] = useState<Step>('welcome');

  useEffect(() => {
    if (profile?.onboardingStep && STEPS.includes(profile.onboardingStep)) {
      setStep(profile.onboardingStep);
    }
  }, [profile?.onboardingStep]);

  const persist = useMutation({
    mutationFn: (s: Step) => api.post('/v1/profile/onboarding-step', { step: s }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profile'] }),
  });

  function goTo(s: Step) {
    setStep(s);
    persist.mutate(s);
  }
  function next() {
    const i = STEPS.indexOf(step);
    if (i < STEPS.length - 1) goTo(STEPS[i + 1]);
  }
  function back() {
    const i = STEPS.indexOf(step);
    if (i > 0) goTo(STEPS[i - 1]);
  }

  async function saveStep<T>(patch: T, endpoint = '/v1/profile') {
    if (endpoint === '/v1/profile') await api.patch(endpoint, patch);
    else await api.post(endpoint, patch);
    await qc.invalidateQueries({ queryKey: ['profile'] });
  }

  return (
    <OnboardingCtx.Provider
      value={{
        step,
        stepIndex: STEPS.indexOf(step),
        goTo,
        next,
        back,
        profile,
        isLoading,
        saveStep,
      }}
    >
      {children}
    </OnboardingCtx.Provider>
  );
}

export function useOnboarding() {
  const v = useContext(OnboardingCtx);
  if (!v) throw new Error('useOnboarding must be inside OnboardingProvider');
  return v;
}
