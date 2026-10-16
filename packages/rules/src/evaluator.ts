import type { EvalContext, ConditionResult } from './types';
import type { Condition as ConditionType } from './schema';

function matchesPattern(value: string, pattern: string, caseSensitive: boolean): boolean {
  const v = caseSensitive ? value : value.toLowerCase();
  const p = caseSensitive ? pattern : pattern.toLowerCase();
  if (!p.includes('*')) return v.includes(p);
  const regex = new RegExp(
    '^' +
      p
        .split('*')
        .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*') +
      '$',
  );
  return regex.test(v);
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9+#.]/g, '');
}

function skillOverlap(profileSkills: string[], required: string[]): number {
  if (required.length === 0) return 1;
  const profileSet = profileSkills.map(normalize);
  let hits = 0;
  for (const req of required) {
    const r = normalize(req);
    if (profileSet.some((p) => p.includes(r) || r.includes(p))) hits++;
  }
  return hits / required.length;
}

export function evaluateCondition(condition: ConditionType, ctx: EvalContext): ConditionResult {
  switch (condition.type) {
    case 'TITLE_MATCHES': {
      const title = ctx.job.title;
      const results = condition.patterns.map((p) =>
        matchesPattern(title, p, condition.caseSensitive),
      );
      const pass = condition.mode === 'all' ? results.every(Boolean) : results.some(Boolean);
      return pass
        ? { pass: true }
        : { pass: false, reason: `Title "${title}" does not match required patterns` };
    }
    case 'EMPLOYER_NOT_IN': {
      const emp = normalize(ctx.job.employer);
      const blocked = condition.employers.some(
        (e) => normalize(e) === emp || emp.includes(normalize(e)),
      );
      return blocked
        ? { pass: false, reason: `Employer "${ctx.job.employer}" is on the exclusion list` }
        : { pass: true };
    }
    case 'STATE_IN': {
      if (!ctx.job.state) return { pass: false, reason: 'Job has no state information' };
      return condition.states.includes(ctx.job.state as any)
        ? { pass: true }
        : { pass: false, reason: `State ${ctx.job.state} not in allowed set` };
    }
    case 'WORK_ARRANGEMENT_IN':
      return condition.values.includes(ctx.job.workArrangement as any)
        ? { pass: true }
        : { pass: false, reason: `Work arrangement ${ctx.job.workArrangement} not allowed` };
    case 'EMPLOYMENT_TYPE_IN':
      return condition.values.includes(ctx.job.employmentType as any)
        ? { pass: true }
        : { pass: false, reason: `Employment type ${ctx.job.employmentType} not allowed` };
    case 'SALARY_MIN_AT_LEAST': {
      const jobSalary = ctx.job.salaryMax ?? ctx.job.salaryMin;
      if (jobSalary == null) {
        return condition.allowMissing
          ? { pass: true }
          : { pass: false, reason: 'Job has no salary information' };
      }
      if ((ctx.job.salaryCurrency ?? 'NGN') !== condition.currency) {
        return { pass: false, reason: `Currency mismatch: job is ${ctx.job.salaryCurrency}` };
      }
      return jobSalary >= condition.amount
        ? { pass: true }
        : {
            pass: false,
            reason: `Salary ${jobSalary} ${condition.currency} below floor ${condition.amount}`,
          };
    }
    case 'REQUIRED_SKILLS_PRESENT': {
      const overlap = skillOverlap(ctx.profile.skills, condition.skills);
      return overlap >= condition.minMatch
        ? { pass: true }
        : {
            pass: false,
            reason: `Skill overlap ${(overlap * 100).toFixed(0)}% below required ${(condition.minMatch * 100).toFixed(0)}%`,
          };
    }
    case 'MAX_EXPERIENCE_REQUIRED': {
      if (ctx.job.experienceYears == null) {
        return condition.allowUnspecified
          ? { pass: true }
          : { pass: false, reason: 'Job has no experience requirement specified' };
      }
      return ctx.job.experienceYears <= condition.years
        ? { pass: true }
        : {
            pass: false,
            reason: `Job requires ${ctx.job.experienceYears} years, above limit ${condition.years}`,
          };
    }
    case 'POSTED_WITHIN_DAYS': {
      if (!ctx.job.publishedAt) return { pass: false, reason: 'Job has no publication date' };
      const ageMs = ctx.now.getTime() - ctx.job.publishedAt.getTime();
      const ageDays = ageMs / 86_400_000;
      return ageDays <= condition.days
        ? { pass: true }
        : {
            pass: false,
            reason: `Posted ${Math.round(ageDays)} days ago, exceeds ${condition.days}`,
          };
    }
    case 'DESCRIPTION_NOT_CONTAINS': {
      const text = condition.caseSensitive
        ? (ctx.job.description ?? '')
        : (ctx.job.description ?? '').toLowerCase();
      for (const term of condition.terms) {
        const t = condition.caseSensitive ? term : term.toLowerCase();
        if (text.includes(t))
          return { pass: false, reason: `Description contains forbidden term "${term}"` };
      }
      return { pass: true };
    }
    case 'SENIORITY_IN': {
      if (!ctx.job.seniority) return { pass: false, reason: 'Job has no seniority information' };
      return condition.values.includes(ctx.job.seniority)
        ? { pass: true }
        : { pass: false, reason: `Seniority ${ctx.job.seniority} not allowed` };
    }
  }
}

export function evaluateAll(
  conditions: ConditionType[],
  ctx: EvalContext,
): { passed: number; total: number; failures: { conditionType: string; reason: string }[] } {
  const failures: { conditionType: string; reason: string }[] = [];
  let passed = 0;
  for (const c of conditions) {
    const r = evaluateCondition(c, ctx);
    if (r.pass) passed++;
    else failures.push({ conditionType: c.type, reason: r.reason });
  }
  return { passed, total: conditions.length, failures };
}
