import {
  amountOwed,
  computeFees,
  countingSeconds,
  deadlineHoursFor,
  DAY_SECONDS,
  multiplierForDay,
  reminderStageDue,
  startedDays,
} from "../disputeFees";

/**
 * Dispute v2 fee schedule — user rulings 2026-10-11 (5, 7, 10). These pin the
 * numbers a renter is actually charged at the kiosk.
 */

const due = new Date("2026-10-01T12:00:00Z");
const at = (days: number) => new Date(due.getTime() + days * DAY_SECONDS * 1000);
const first = { offense: 1, base: 50, cap: 10_000, startAt: due, frozenSeconds: 0, frozenAt: null };

describe("startedDays", () => {
  it("nothing before the clock starts, and a started day counts", () => {
    expect(startedDays(0)).toBe(0);
    expect(startedDays(-5)).toBe(0);
    expect(startedDays(1)).toBe(1);
    expect(startedDays(DAY_SECONDS)).toBe(1);
    expect(startedDays(DAY_SECONDS + 1)).toBe(2);
  });
});

describe("first offence: 1x days 1-3, 1.5x days 4-7, 2x from day 8", () => {
  it("multipliers by day", () => {
    expect([1, 2, 3].map((d) => multiplierForDay(d, 1))).toEqual([1, 1, 1]);
    expect([4, 7].map((d) => multiplierForDay(d, 1))).toEqual([1.5, 1.5]);
    expect([8, 30].map((d) => multiplierForDay(d, 1))).toEqual([2, 2]);
  });

  it("returned before the due date: nothing yet", () => {
    expect(computeFees(first, at(-1)).accrued).toBe(0);
  });

  it("3 days = 3 x 50", () => {
    expect(computeFees(first, at(3)).accrued).toBe(150);
  });

  it("7 days = 150 + 4 x 75", () => {
    const s = computeFees(first, at(7));
    expect(s.accrued).toBe(450);
    expect(s.lines.map((l) => [l.fromDay, l.toDay, l.amount])).toEqual([
      [1, 3, 150],
      [4, 7, 300],
    ]);
    expect(s.nextDayCharge).toBe(100);
  });

  it("10 days = 450 + 3 x 100", () => {
    expect(computeFees(first, at(10)).accrued).toBe(750);
  });

  it("is capped at the replacement value", () => {
    const s = computeFees({ ...first, cap: 400 }, at(10));
    expect(s.accrued).toBe(400);
    expect(s.capped).toBe(true);
    expect(s.nextDayCharge).toBe(0);
  });
});

describe("repeat offence: 2x at once, 3x from day 3", () => {
  it("starts at 2x on day 1", () => {
    const s = computeFees({ ...first, offense: 2 }, at(0.5));
    expect(s.accrued).toBe(100);
  });

  it("2 days at 2x then 3x", () => {
    expect(computeFees({ ...first, offense: 2 }, at(4)).accrued).toBe(100 * 2 + 150 * 2);
  });
});

describe("freezing (ruling 7)", () => {
  it("the clock stops at frozenAt", () => {
    const s = computeFees({ ...first, frozenAt: at(2) }, at(20));
    expect(s.days).toBe(2);
    expect(s.accrued).toBe(100);
    expect(s.frozen).toBe(true);
  });

  it("past frozen time is not counted after it resumes", () => {
    // 5 days elapsed, 3 of them frozen -> 2 counting days.
    expect(countingSeconds({ startAt: due, frozenSeconds: 3 * DAY_SECONDS, frozenAt: null }, at(5))).toBe(
      2 * DAY_SECONDS,
    );
    expect(computeFees({ ...first, frozenSeconds: 3 * DAY_SECONDS }, at(5)).accrued).toBe(100);
  });
});

describe("amountOwed", () => {
  it("subtracts payments and the late fee already recorded, never below zero", () => {
    expect(amountOwed(450, 100, 50)).toBe(300);
    expect(amountOwed(100, 150, 0)).toBe(0);
  });
});

describe("deadline (ruling 4 and 10)", () => {
  it("defaults to 72 h and accepts only 24/48/72", () => {
    expect(deadlineHoursFor(1)).toBe(72);
    expect(deadlineHoursFor(1, 48)).toBe(48);
    expect(deadlineHoursFor(1, 5)).toBe(72);
  });
  it("a repeat offence is always 24 h", () => {
    expect(deadlineHoursFor(2, 72)).toBe(24);
  });
});

describe("reminders (ruling 11): day 0, 1, 2 and the deadline", () => {
  const opened = new Date("2026-10-11T00:00:00Z");
  const deadline = new Date("2026-10-14T00:00:00Z");
  const h = (n: number) => new Date(opened.getTime() + n * 3_600_000);
  it("steps through the stages", () => {
    expect(reminderStageDue(opened, deadline, h(1))).toBe(0);
    expect(reminderStageDue(opened, deadline, h(25))).toBe(1);
    expect(reminderStageDue(opened, deadline, h(49))).toBe(2);
    expect(reminderStageDue(opened, deadline, h(72))).toBe(3);
  });
  it("a 24 h deadline jumps straight to the deadline stage", () => {
    expect(reminderStageDue(opened, h(24), h(24))).toBe(3);
  });
});
