export type WorkArrangement = 'REMOTE' | 'HYBRID' | 'ONSITE' | 'UNKNOWN';
export type EmploymentType =
  | 'FULL_TIME' | 'PART_TIME' | 'CONTRACT'
  | 'INTERNSHIP' | 'TEMPORARY' | 'UNKNOWN';

export type NigerianState =
  | 'ABIA' | 'ADAMAWA' | 'AKWA_IBOM' | 'ANAMBRA' | 'BAUCHI' | 'BAYELSA' | 'BENUE'
  | 'BORNO' | 'CROSS_RIVER' | 'DELTA' | 'EBONYI' | 'EDO' | 'EKITI' | 'ENUGU'
  | 'FCT' | 'GOMBE' | 'IMO' | 'JIGAWA' | 'KADUNA' | 'KANO' | 'KATSINA' | 'KEBBI'
  | 'KOGI' | 'KWARA' | 'LAGOS' | 'NASARAWA' | 'NIGER' | 'OGUN' | 'ONDO' | 'OSUN'
  | 'OYO' | 'PLATEAU' | 'RIVERS' | 'SOKOTO' | 'TARABA' | 'YOBE' | 'ZAMFARA'
  | 'UNKNOWN';

export type RuleOutcome = 'ELIGIBLE' | 'INELIGIBLE' | 'REVIEW';

export interface ConditionPass { pass: true }
export interface ConditionFail { pass: false; reason: string }
export type ConditionResult = ConditionPass | ConditionFail;

export interface EvalContext {
  job: {
    title: string;
    description?: string | null;
    employer: string;
    state?: NigerianState | null;
    workArrangement: WorkArrangement;
    employmentType: EmploymentType;
    salaryMin?: number | null;
    salaryMax?: number | null;
    salaryCurrency?: string | null;
    requiredSkills: string[];
    preferredSkills: string[];
    experienceYears?: number | null;
    seniority?: string | null;
    publishedAt?: Date | null;
  };
  profile: {
    targetRoles: string[];
    yearsExperience?: number | null;
    skills: string[];
    preferredStates: NigerianState[];
    remoteOnly: boolean;
    salaryFloor?: number | null;
    salaryCurrency: string;
    excludedCompanies: string[];
    employmentTypes: EmploymentType[];
  };
  now: Date;
}

export interface ConditionFailure {
  conditionType: string;
  reason: string;
}

export interface RuleResult {
  outcome: RuleOutcome;
  hardPassed: boolean;
  hardFailures: ConditionFailure[];
  softTotal: number;
  softPassed: number;
  softRatio: number;
  reasons: string[];
}
