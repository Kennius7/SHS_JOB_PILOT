export type ApplicationState =
  | 'DISCOVERED'
  | 'MATCHED'
  | 'ELIGIBILITY_CHECKED'
  | 'DRAFT_PREPARED'
  | 'AWAITING_APPROVAL'
  | 'QUEUED'
  | 'SUBMITTING'
  | 'SUBMITTED'
  | 'CONFIRMED'
  | 'SKIPPED'
  | 'NEEDS_USER_INPUT'
  | 'MANUAL_APPLICATION_REQUIRED'
  | 'FAILED'
  | 'UNKNOWN_OUTCOME';

export const TRANSITIONS: Record<ApplicationState, ApplicationState[]> = {
  DISCOVERED: ['MATCHED', 'SKIPPED', 'MANUAL_APPLICATION_REQUIRED', 'FAILED'],
  MATCHED: ['ELIGIBILITY_CHECKED', 'SKIPPED', 'FAILED'],
  ELIGIBILITY_CHECKED: ['DRAFT_PREPARED', 'SKIPPED', 'MANUAL_APPLICATION_REQUIRED', 'FAILED'],
  DRAFT_PREPARED: [
    'AWAITING_APPROVAL',
    'QUEUED',
    'SKIPPED',
    'MANUAL_APPLICATION_REQUIRED',
    'FAILED',
  ],
  AWAITING_APPROVAL: ['QUEUED', 'SKIPPED', 'NEEDS_USER_INPUT'],
  QUEUED: ['SUBMITTING', 'SKIPPED', 'FAILED'],
  SUBMITTING: ['SUBMITTED', 'NEEDS_USER_INPUT', 'FAILED', 'UNKNOWN_OUTCOME', 'QUEUED'],
  SUBMITTED: ['CONFIRMED', 'UNKNOWN_OUTCOME', 'FAILED'],
  CONFIRMED: [],
  SKIPPED: [],
  NEEDS_USER_INPUT: ['DRAFT_PREPARED', 'QUEUED', 'SKIPPED', 'FAILED'],
  MANUAL_APPLICATION_REQUIRED: ['SKIPPED'],
  FAILED: ['QUEUED'],
  UNKNOWN_OUTCOME: ['CONFIRMED', 'FAILED', 'QUEUED'],
};

export const TERMINAL_STATES: ApplicationState[] = ['CONFIRMED', 'SKIPPED'];

export const USER_SKIPPABLE: ApplicationState[] = [
  'DISCOVERED',
  'MATCHED',
  'ELIGIBILITY_CHECKED',
  'DRAFT_PREPARED',
  'AWAITING_APPROVAL',
  'QUEUED',
  'NEEDS_USER_INPUT',
  'MANUAL_APPLICATION_REQUIRED',
];

export const POST_SUBMISSION_STATES: ApplicationState[] = [
  'SUBMITTING',
  'SUBMITTED',
  'CONFIRMED',
  'UNKNOWN_OUTCOME',
];

export class IllegalStateTransitionError extends Error {
  constructor(
    public from: ApplicationState,
    public to: ApplicationState,
  ) {
    super(`Illegal transition: ${from} → ${to}`);
  }
}

export function canTransition(from: ApplicationState, to: ApplicationState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertCanTransition(from: ApplicationState, to: ApplicationState): void {
  if (!canTransition(from, to)) throw new IllegalStateTransitionError(from, to);
}
