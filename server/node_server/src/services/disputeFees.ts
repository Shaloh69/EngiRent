/**
 * Dispute v2 — the wrong-item fee schedule (user rulings 2026-10-11, 5, 7, 10).
 *
 * Pure, so every number a renter is charged can be pinned by a unit test and
 * recomputed by anyone reading a case: nothing here reads the clock, the
 * database or the environment. The caller passes `now`.
 *
 * First offence (ruling 5): the base is the item's `pricePerDay`, counted from
 * the rental's due date: days 1-3 at 1x per day, days 4-7 at 1.5x, day 8 on at
 * 2x, capped at the item's replacement value. A started day counts as a day.
 *
 * Repeat offence (ruling 10): fees restart at 2x immediately and escalate
 * faster: days 1-2 at 2x, day 3 on at 3x. Paid fees from the earlier case are
 * kept; the caller lowers this case's cap by what was already paid, so the
 * cumulative total never passes the replacement value.
 *
 * Freezing (ruling 7): time spent with a payment submitted does not count.
 * `frozenSeconds` is the total of past frozen intervals; `frozenAt` is set
 * while frozen right now, and the clock stops there.
 */

export const DAY_SECONDS = 24 * 60 * 60;

export interface FeeBand {
  /** First day of the band, 1-based, inclusive. */
  fromDay: number;
  /** Last day of the band, inclusive; null for "and every day after". */
  toDay: number | null;
  multiplier: number;
}

export const FIRST_OFFENCE_BANDS: FeeBand[] = [
  { fromDay: 1, toDay: 3, multiplier: 1 },
  { fromDay: 4, toDay: 7, multiplier: 1.5 },
  { fromDay: 8, toDay: null, multiplier: 2 },
];

export const REPEAT_OFFENCE_BANDS: FeeBand[] = [
  { fromDay: 1, toDay: 2, multiplier: 2 },
  { fromDay: 3, toDay: null, multiplier: 3 },
];

export function bandsFor(offense: number): FeeBand[] {
  return offense >= 2 ? REPEAT_OFFENCE_BANDS : FIRST_OFFENCE_BANDS;
}

export interface FeeInput {
  offense: number;
  /** The item's price per day at the time the case opened. */
  base: number;
  /** The most this case may ever charge. */
  cap: number;
  /** When the fee clock starts (the due date, or the open time). */
  startAt: Date;
  frozenSeconds: number;
  frozenAt: Date | null;
}

export interface FeeLine {
  fromDay: number;
  toDay: number;
  days: number;
  multiplier: number;
  perDay: number;
  amount: number;
}

export interface FeeStatement {
  /** Started days that count (0 before the clock starts). */
  days: number;
  lines: FeeLine[];
  /** Sum of the lines before the cap. */
  uncapped: number;
  /** What the schedule charges, after the cap. */
  accrued: number;
  capped: boolean;
  frozen: boolean;
  /** The next day's charge, so a screen can say "tomorrow it becomes ₱X". */
  nextDayCharge: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Seconds that count toward the fee, after removing frozen time. */
export function countingSeconds(input: Pick<FeeInput, "startAt" | "frozenSeconds" | "frozenAt">, now: Date): number {
  const end = input.frozenAt && input.frozenAt < now ? input.frozenAt : now;
  const raw = (end.getTime() - input.startAt.getTime()) / 1000;
  return Math.max(0, raw - Math.max(0, input.frozenSeconds));
}

/** Started days: 1 second past the start is day 1. */
export function startedDays(seconds: number): number {
  return seconds <= 0 ? 0 : Math.ceil(seconds / DAY_SECONDS);
}

export function multiplierForDay(day: number, offense: number): number {
  for (const band of bandsFor(offense)) {
    if (day >= band.fromDay && (band.toDay === null || day <= band.toDay)) return band.multiplier;
  }
  return 0;
}

export function computeFees(input: FeeInput, now: Date): FeeStatement {
  const days = startedDays(countingSeconds(input, now));
  const base = Math.max(0, input.base);
  const cap = Math.max(0, input.cap);

  const lines: FeeLine[] = [];
  for (const band of bandsFor(input.offense)) {
    if (days < band.fromDay) break;
    const toDay = band.toDay === null ? days : Math.min(days, band.toDay);
    const n = toDay - band.fromDay + 1;
    if (n <= 0) continue;
    const perDay = round2(base * band.multiplier);
    lines.push({
      fromDay: band.fromDay,
      toDay,
      days: n,
      multiplier: band.multiplier,
      perDay,
      amount: round2(perDay * n),
    });
  }

  const uncapped = round2(lines.reduce((s, l) => s + l.amount, 0));
  const accrued = round2(Math.min(uncapped, cap));
  const nextDay = days + 1;
  const nextDayCharge = round2(
    Math.max(0, Math.min(cap - accrued, base * multiplierForDay(nextDay, input.offense))),
  );

  return {
    days,
    lines,
    uncapped,
    accrued,
    capped: uncapped > cap,
    frozen: input.frozenAt !== null,
    nextDayCharge,
  };
}

/**
 * What the renter still owes on this case: the schedule, less what they have
 * already paid on it, less any late fee already recorded for the same days
 * (a first offence counts from the due date, which is exactly the period the
 * daily late-fee job may already have charged; those rows are settled from
 * the deposit, so charging the days again here would bill them twice).
 */
export function amountOwed(accrued: number, paid: number, lateFeeCredit: number): number {
  return round2(Math.max(0, accrued - Math.max(0, paid) - Math.max(0, lateFeeCredit)));
}

/** Ruling 4: 1, 2 or 3 days; a repeat offence is always 24 h (ruling 10). */
export const ALLOWED_DEADLINE_HOURS = [24, 48, 72] as const;
export const DEFAULT_DEADLINE_HOURS = 72;
export const REPEAT_DEADLINE_HOURS = 24;

export function deadlineHoursFor(offense: number, requested?: number | null): number {
  if (offense >= 2) return REPEAT_DEADLINE_HOURS;
  if (requested != null && (ALLOWED_DEADLINE_HOURS as readonly number[]).includes(requested)) return requested;
  return DEFAULT_DEADLINE_HOURS;
}

/**
 * Ruling 11: reminders at day 0 (the opening), day 1, day 2 and the deadline.
 * Returns the highest stage that is due at `now`; the caller sends every
 * stage above the one it last sent, so a sweep that missed a tick catches up
 * with one message rather than none.
 */
export function reminderStageDue(openedAt: Date, deadlineAt: Date, now: Date): number {
  if (now >= deadlineAt) return 3;
  const hours = (now.getTime() - openedAt.getTime()) / 3_600_000;
  if (hours >= 48) return 2;
  if (hours >= 24) return 1;
  return 0;
}
