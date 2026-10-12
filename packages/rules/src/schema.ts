import { z } from 'zod';

export const NigerianStateSchema = z.enum([
  'ABIA','ADAMAWA','AKWA_IBOM','ANAMBRA','BAUCHI','BAYELSA','BENUE','BORNO',
  'CROSS_RIVER','DELTA','EBONYI','EDO','EKITI','ENUGU','FCT','GOMBE','IMO',
  'JIGAWA','KADUNA','KANO','KATSINA','KEBBI','KOGI','KWARA','LAGOS','NASARAWA',
  'NIGER','OGUN','ONDO','OSUN','OYO','PLATEAU','RIVERS','SOKOTO','TARABA',
  'YOBE','ZAMFARA','UNKNOWN',
]);

export const WorkArrangementSchema = z.enum(['REMOTE', 'HYBRID', 'ONSITE', 'UNKNOWN']);
export const EmploymentTypeSchema = z.enum([
  'FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'TEMPORARY', 'UNKNOWN',
]);

const CaseSensitivity = z.boolean().default(false);

export const ConditionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('TITLE_MATCHES'),
    patterns: z.array(z.string().min(1).max(120)).min(1).max(20),
    mode: z.enum(['any', 'all']).default('any'),
    caseSensitive: CaseSensitivity,
  }),
  z.object({
    type: z.literal('EMPLOYER_NOT_IN'),
    employers: z.array(z.string().min(1).max(200)).max(500),
  }),
  z.object({
    type: z.literal('STATE_IN'),
    states: z.array(NigerianStateSchema).min(1).max(37),
  }),
  z.object({
    type: z.literal('WORK_ARRANGEMENT_IN'),
    values: z.array(WorkArrangementSchema).min(1).max(4),
  }),
  z.object({
    type: z.literal('EMPLOYMENT_TYPE_IN'),
    values: z.array(EmploymentTypeSchema).min(1).max(6),
  }),
  z.object({
    type: z.literal('SALARY_MIN_AT_LEAST'),
    amount: z.number().nonnegative().max(1_000_000_000),
    currency: z.string().length(3).default('NGN'),
    allowMissing: z.boolean().default(false),
  }),
  z.object({
    type: z.literal('REQUIRED_SKILLS_PRESENT'),
    skills: z.array(z.string().min(1).max(60)).min(1).max(50),
    minMatch: z.number().min(0).max(1).default(0.5),
  }),
  z.object({
    type: z.literal('MAX_EXPERIENCE_REQUIRED'),
    years: z.number().int().nonnegative().max(60),
    allowUnspecified: z.boolean().default(true),
  }),
  z.object({
    type: z.literal('POSTED_WITHIN_DAYS'),
    days: z.number().int().positive().max(365),
  }),
  z.object({
    type: z.literal('DESCRIPTION_NOT_CONTAINS'),
    terms: z.array(z.string().min(1).max(80)).min(1).max(50),
    caseSensitive: CaseSensitivity,
  }),
  z.object({
    type: z.literal('SENIORITY_IN'),
    values: z.array(z.string().min(1).max(40)).min(1).max(20),
  }),
]);

export type Condition = z.infer<typeof ConditionSchema>;

export const RuleConditionsSchema = z.object({
  hard: z.array(ConditionSchema).max(30).default([]),
  soft: z
    .object({
      conditions: z.array(ConditionSchema).max(30).default([]),
      minPassRatio: z.number().min(0).max(1).default(0.5),
    })
    .default({ conditions: [], minPassRatio: 0.5 }),
  minMatchScore: z.number().min(0).max(100).default(70),
});

export type RuleConditions = z.infer<typeof RuleConditionsSchema>;
