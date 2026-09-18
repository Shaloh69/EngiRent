import {
  depositVerdict,
  returnVerdict,
  MAX_ATTEMPTS_BEFORE_REVIEW,
} from "../verdictPolicy";

/**
 * D-89 — found in the second physical test. A correct glue gun came back RETRY
 * four times, re-opening the door each time, headed for REJECTED at attempt 10
 * — which cancels the renter's paid rental. The quick check scores it ~53
 * because the locker's background and lighting differ from the listing
 * photos, which repositioning cannot change. These pin the user's ruling:
 * below 85, a person decides.
 */

describe("depositVerdict", () => {
  it("allows exactly one retry: the first attempt's RETRY is honoured", () => {
    const v = depositVerdict("RETRY", 1);
    expect(v.decision).toBe("RETRY");
    expect(v.escalated).toBe(false);
  });

  it("sends a second RETRY to a person instead of re-opening the door", () => {
    const v = depositVerdict("RETRY", MAX_ATTEMPTS_BEFORE_REVIEW);
    expect(v.decision).toBe("PENDING");
    expect(v.escalated).toBe(true);
    expect(v.note).toMatch(/Sent for review/);
  });

  it("the exact failure from the test: attempts 2, 3, 4 all go to review", () => {
    for (const attempt of [2, 3, 4]) {
      expect(depositVerdict("RETRY", attempt).decision).toBe("PENDING");
    }
  });

  it("never auto-rejects a deposit — even on the very first attempt", () => {
    // REJECTED used to cancel the paid rental and move the item with the
    // actuator, on a quick check that scores a correct item at 53.
    for (const attempt of [1, 2, 10]) {
      const v = depositVerdict("REJECTED", attempt);
      expect(v.decision).toBe("PENDING");
      expect(v.escalated).toBe(true);
      expect(v.note).toMatch(/person/);
    }
  });

  it("leaves APPROVED and PENDING alone", () => {
    expect(depositVerdict("APPROVED", 1)).toEqual({ decision: "APPROVED", escalated: false, note: null });
    expect(depositVerdict("PENDING", 3)).toEqual({ decision: "PENDING", escalated: false, note: null });
  });
});

describe("returnVerdict", () => {
  it("caps retries the same way", () => {
    expect(returnVerdict("RETRY", 1).decision).toBe("RETRY");
    expect(returnVerdict("RETRY", MAX_ATTEMPTS_BEFORE_REVIEW).decision).toBe("PENDING");
  });

  it("leaves REJECTED alone — on a return it already goes to a person as DISPUTED", () => {
    const v = returnVerdict("REJECTED", 1);
    expect(v.decision).toBe("REJECTED");
    expect(v.escalated).toBe(false);
  });
});
