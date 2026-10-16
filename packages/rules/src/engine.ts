import type { EvalContext, RuleResult, ConditionFailure } from './types';
import type { RuleConditions } from './schema';
import { evaluateAll } from './evaluator';

export function evaluateRule(conditions: RuleConditions, ctx: EvalContext): RuleResult {
  const hard = evaluateAll(conditions.hard, ctx);
  const hardPassed = hard.failures.length === 0;
  const hardFailures: ConditionFailure[] = hard.failures;

  if (!hardPassed) {
    return {
      outcome: 'INELIGIBLE',
      hardPassed: false,
      hardFailures,
      softTotal: conditions.soft.conditions.length,
      softPassed: 0,
      softRatio: 0,
      reasons: hardFailures.map((f) => `${f.conditionType}: ${f.reason}`),
    };
  }

  const soft = evaluateAll(conditions.soft.conditions, ctx);
  const softRatio = soft.total === 0 ? 1 : soft.passed / soft.total;

  let outcome: RuleResult['outcome'];
  if (soft.total === 0 || softRatio >= conditions.soft.minPassRatio) outcome = 'ELIGIBLE';
  else outcome = 'REVIEW';

  const reasons: string[] = [];
  if (soft.total > 0) {
    reasons.push(
      `Soft conditions: ${soft.passed}/${soft.total} passed (${(softRatio * 100).toFixed(0)}%)`,
    );
  }
  for (const f of soft.failures) reasons.push(`${f.conditionType}: ${f.reason}`);

  return {
    outcome,
    hardPassed: true,
    hardFailures: [],
    softTotal: soft.total,
    softPassed: soft.passed,
    softRatio,
    reasons,
  };
}
