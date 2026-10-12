'use client';

import { useOnboarding } from '@/lib/onboarding-context';
import { WelcomeStep } from './steps/welcome-step';
import { ReviewCvStep } from './steps/review-cv-step';
import { ContactStep } from './steps/contact-step';
import { CareerStep } from './steps/career-step';
import { SkillsStep } from './steps/skills-step';
import { PreferencesStep } from './steps/preferences-step';
import { RulesStep } from './steps/rules-step';
import { DoneStep } from './steps/done-step';

export default function OnboardingPage() {
  const { step, isLoading } = useOnboarding();
  if (isLoading) return <div className="text-center text-sm text-slate-500">Loading…</div>;
  switch (step) {
    case 'welcome': return <WelcomeStep />;
    case 'review-cv': return <ReviewCvStep />;
    case 'contact': return <ContactStep />;
    case 'career': return <CareerStep />;
    case 'skills': return <SkillsStep />;
    case 'preferences': return <PreferencesStep />;
    case 'rules': return <RulesStep />;
    case 'done': return <DoneStep />;
  }
}
