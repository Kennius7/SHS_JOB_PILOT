import { EmploymentType, SalaryPeriod, WorkArrangement } from '../types';

const FULL_TIME_TOKENS = [
  'full time',
  'full_time',
  'full-time',
  'permanent',
  'full-time employment',
];
const PART_TIME_TOKENS = ['part time', 'part_time', 'part-time'];
const CONTRACT_TOKENS = ['contract', 'contractor', 'freelance', 'freelancer', 'c2c'];
const INTERNSHIP_TOKENS = ['internship', 'intern', 'graduate trainee'];
const TEMPORARY_TOKENS = ['temporary', 'temp', 'seasonal'];

const REMOTE_TOKENS = ['remote', 'work from home', 'wfh', 'telecommute', '100% home'];
const HYBRID_TOKENS = ['hybrid', 'partially remote'];

/** Map free-form employment type labels to the normalized enum. */
export function mapEmploymentType(...labels: Array<string | null | undefined>): EmploymentType {
  const text = labels.join(' ').toLowerCase();
  if (!text) return 'UNKNOWN';
  if (FULL_TIME_TOKENS.some((t) => text.includes(t))) return 'FULL_TIME';
  if (PART_TIME_TOKENS.some((t) => text.includes(t))) return 'PART_TIME';
  if (CONTRACT_TOKENS.some((t) => text.includes(t))) return 'CONTRACT';
  if (INTERNSHIP_TOKENS.some((t) => text.includes(t))) return 'INTERNSHIP';
  if (TEMPORARY_TOKENS.some((t) => text.includes(t))) return 'TEMPORARY';
  return 'UNKNOWN';
}

/** Infer the work arrangement from free text; explicit markers win. */
export function inferWorkArrangement(text: string, explicit?: string | null): WorkArrangement {
  const body = `${explicit ?? ''} ${text}`.toLowerCase();
  if (REMOTE_TOKENS.some((t) => body.includes(t))) return 'REMOTE';
  if (HYBRID_TOKENS.some((t) => body.includes(t))) return 'HYBRID';
  return 'UNKNOWN';
}

export interface ParsedSalaryRange {
  min?: number;
  max?: number;
  currency?: string;
  period?: SalaryPeriod;
}

/**
 * Parse a free-form salary string such as "$60,000 - $80,000 /year",
 * "₦400k - ₦600k monthly", or "100k–140k". Returns undefined when unusable.
 */
export function parseSalaryRange(value?: string | null): ParsedSalaryRange | undefined {
  if (!value) return undefined;

  const currencyMatch = value.match(/[$€£₦฿₹¥A-Za-z\u20A6]{1,3}/);
  const currency = currencyMatch ? normalizeCurrency(currencyMatch[0]) : undefined;

  const numbers =
    value
      .match(/\d[\d,.]*/g)
      ?.map((n) => Number(n.replace(/[,\s]/g, '')))
      .filter(Number.isFinite) ?? [];
  if (numbers.length === 0) return undefined;
  if (value.toLowerCase().includes('k') && numbers.every((n) => n < 10000)) {
    numbers.forEach((n, i) => (numbers[i] = n * 1000));
  }

  const periodMatch = value
    .toLowerCase()
    .match(
      /\/(year|yr|annum|month|mo|hour|day|week)|(per annum|per year|per month|per hour|a year|annual|monthly|hourly)/,
    );
  const period = periodMatch ? periodFromToken(periodMatch[1] ?? periodMatch[2]) : undefined;

  const i = numbers.length > 1 ? numbers[0] : undefined;
  const j = numbers.length > 1 ? numbers[numbers.length - 1] : numbers[0];
  return {
    min: i,
    max: j,
    currency,
    period,
  };
}

function normalizeCurrency(raw: string): string | undefined {
  const map: Record<string, string> = {
    $: 'USD',
    '€': 'EUR',
    '£': 'GBP',
    '₦': 'NGN',
    NGN: 'NGN',
    USD: 'USD',
    EUR: 'EUR',
    GBP: 'GBP',
    KSH: 'KES',
    '₵': 'GHS',
    R: 'ZAR',
  };
  return map[raw.toUpperCase()];
}

export function periodFromToken(token?: string): SalaryPeriod | undefined {
  if (!token) return undefined;
  const t = token.toLowerCase();
  if (t.startsWith('year') || t.startsWith('yr') || t.startsWith('annum') || t.includes('annual'))
    return 'YEAR';
  if (t.startsWith('month') || t.startsWith('mo') || t.includes('monthly')) return 'MONTH';
  if (t.startsWith('hour') || t.includes('hourly')) return 'HOUR';
  if (t.startsWith('day')) return 'DAY';
  return undefined;
}
