import { z } from 'zod';

export const ParsedCvSchema = z.object({
  fullName: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  skills: z.array(z.string()).max(50),
  experience: z
    .array(
      z.object({
        title: z.string(),
        employer: z.string(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        highlights: z.array(z.string()).max(5).optional(),
      }),
    )
    .max(20),
  education: z
    .array(
      z.object({
        institution: z.string(),
        degree: z.string().optional(),
        field: z.string().optional(),
      }),
    )
    .max(10),
  yearsExperience: z.number().optional(),
  certifications: z.array(z.string()).max(20).optional(),
  languages: z.array(z.string()).max(10).optional(),
  summary: z.string().max(500).optional(),
});
export type ParsedCv = z.infer<typeof ParsedCvSchema>;

export const MatchScoreSchema = z.object({
  overallScore: z.number().min(0).max(100),
  breakdown: z.object({
    skills: z.number().min(0).max(100),
    experience: z.number().min(0).max(100),
    location: z.number().min(0).max(100),
    salary: z.number().min(0).max(100),
    roleDirection: z.number().min(0).max(100),
  }),
  missingRequired: z.array(z.string()).max(20),
  reasons: z.array(z.string()).max(10),
  hardEligibilityFail: z.boolean(),
});
export type MatchScore = z.infer<typeof MatchScoreSchema>;

export interface MatchInput {
  profile: {
    fullName?: string;
    skills: string[];
    experience: { title: string; employer: string; highlights?: string[] }[];
    education: { institution: string; degree?: string }[];
    yearsExperience?: number;
    summary?: string;
  };
  preferences: {
    targetRoles: string[];
    preferredStates: string[];
    remoteOnly: boolean;
    salaryFloor?: number;
    salaryCurrency: string;
  };
  job: {
    title: string;
    employer: string;
    description: string;
    requiredSkills: string[];
    preferredSkills: string[];
    state?: string;
    workArrangement: string;
    salaryMin?: number;
    salaryMax?: number;
    salaryCurrency?: string;
  };
}

export interface CoverLetterInput {
  profile: {
    fullName?: string;
    skills: string[];
    experience: { title: string; employer: string; highlights?: string[] }[];
    education: { institution: string; degree?: string }[];
    yearsExperience?: number;
    summary?: string;
  };
  job: {
    title: string;
    employer: string;
    description: string;
  };
  tone?: 'professional' | 'warm' | 'direct';
}

export interface AiAdapter {
  parseCv(text: string): Promise<ParsedCv>;
  scoreMatch(input: MatchInput): Promise<MatchScore>;
  generateCoverLetter(input: CoverLetterInput): Promise<string>;
}
