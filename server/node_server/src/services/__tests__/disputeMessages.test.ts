import { ownerNotice, renterPrompt, renterPromptTitle, reminderText } from "../disputeMessages";

const base = {
  reference: "ER-DSP-2026-0001",
  itemTitle: "Hand Rivets",
  offense: 1,
  returnedAt: new Date("2026-10-10T17:01:00Z"),
  lockerNumber: "1",
  wrongItemDoor: "bottom_door",
  deadlineAt: new Date("2026-10-14T10:00:00Z"),
  deadlineHours: 72,
  feeBase: 50,
  feeCap: 1200,
  feeStartAt: new Date("2026-10-09T10:00:00Z"),
  owed: 150,
  aiHeadline: "Not a match: the colours are clearly different from the listing.",
};

describe("renter prompt (agreed draft, ruling 3 + 12)", () => {
  it("first offence: steps in kiosk order, consequences, the review path", () => {
    const t = renterPrompt(base);
    expect(renterPromptTitle(base)).toBe("Return disputed: action required within 3 days");
    const pay = t.indexOf("pay the amount owed");
    const place = t.indexOf("Put the correct Hand Rivets");
    const collect = t.indexOf("Collect the item you left from locker 1, lower door");
    expect(pay).toBeGreaterThan(0);
    expect(place).toBeGreaterThan(pay);
    expect(collect).toBeGreaterThan(place);
    expect(t).toMatch(/You do not need to pay first/);
    expect(t).toMatch(/University of Cebu Lapu-Lapu and Mandaue/);
    expect(t).toMatch(/Student Affairs Office \(SAO\), the Engineering Faculty and the Guidance Office/);
    expect(t).toMatch(/parent or guardian/);
    expect(t).toMatch(/Request a review or contact support/);
    expect(t).toMatch(/₱150\.00 now/);
    expect(t).toMatch(/What the AI saw: Not a match/);
  });

  it("a repeat offence is harsher and says so", () => {
    const c = { ...base, offense: 2, deadlineHours: 24 };
    expect(renterPromptTitle(c)).toMatch(/^Second wrong item: account suspended/);
    const t = renterPrompt(c);
    expect(t).toMatch(/SECOND wrong item/);
    expect(t).toMatch(/Fees you already paid on the first case are kept/);
    expect(t).toMatch(/twice the item's daily price/);
  });
});

describe("fee cap wording (user ruling 2026-10-11)", () => {
  it("never calls the interim cap a replacement value", () => {
    const t = renterPrompt({ ...base, feeCap: 900, feeCapSource: "FALLBACK" });
    expect(t).toMatch(/up to ₱900\.00 \(30 days of the daily price or the deposit, whichever is larger/);
    expect(t).not.toMatch(/replacement value of/);
  });
  it("names the owner's replacement value once it exists", () => {
    expect(renterPrompt({ ...base, feeCapSource: "REPLACEMENT_VALUE" })).toMatch(/replacement value of ₱1,200\.00/);
  });
});

describe("owner notice (ruling 9)", () => {
  it("asks nothing of the owner and says the payout is held", () => {
    const t = ownerNotice(base);
    expect(t).toMatch(/You do not need to do anything/);
    expect(t).toMatch(/payout for this rental is on hold/);
    expect(t).not.toMatch(/collect it from locker/i);
  });
});

describe("reminders (ruling 11)", () => {
  it("the deadline reminder says the case is escalated", () => {
    expect(reminderText(base, 3)).toMatch(/has been escalated/);
    expect(reminderText(base, 1)).toMatch(/has not been returned yet/);
  });
});
