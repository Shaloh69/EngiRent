import { plainVerdict } from "../aiVerdictSummary";

/**
 * Ruling 15 — the AI's verdict in plain words. Pinned against D-112's real
 * lookalike (identity 0.6254, same-kind 0.9056, score 77.87).
 */

describe("plainVerdict", () => {
  const lookalike = {
    itemTitle: "Hand Rivets",
    score: 77.87,
    mlEvidence: {
      pipeline: "v2",
      confidence: 77.87,
      placement: { verdict: "OK" },
      evidence: { dino_max: 0.6254, sem_bc: 0.9056, colour: 0.12 },
    },
  };

  it("describes the D-112 lookalike the way the ruling's example does", () => {
    const v = plainVerdict({ ...lookalike, adminDecision: "REJECTED" });
    expect(v.headline).toMatch(/^Not a match: /);
    expect(v.headline).toMatch(/colours are clearly different/);
    expect(v.headline).toMatch(/only loosely matches/);
    expect(v.points.join(" ")).toMatch(/77\.9 out of 100/);
    expect(v.points.join(" ")).toMatch(/very little weight/);
    expect(v.source).toBe("quick");
  });

  it("names colours only when the ML service reported them", () => {
    const named = plainVerdict({
      ...lookalike,
      mlEvidence: {
        ...lookalike.mlEvidence,
        evidence: { ...lookalike.mlEvidence.evidence, locker_colours: ["red"], listing_colours: ["yellow", "black"] },
      },
      adminDecision: "REJECTED",
    });
    expect(named.headline).toMatch(/the item is red and the listing is yellow and black/);
    expect(plainVerdict(lookalike).headline).not.toMatch(/red|yellow/);
  });

  it("prefers the full run's evidence when it exists", () => {
    const v = plainVerdict({
      ...lookalike,
      deepReviewScore: 40,
      deepReviewDetails: { evidence: { evidence: { dino_max: 0.3, sem_bc: 0.4, colour: 0.7 } } },
    });
    expect(v.source).toBe("full");
    expect(v.score).toBe(40);
    expect(v.headline).toMatch(/^Likely not a match/);
    expect(v.headline).toMatch(/does not match/);
  });

  it("says plainly when there is no verdict at all", () => {
    const v = plainVerdict({ itemTitle: "X", score: 0, unavailable: true, unavailableReason: "ml_unreachable" });
    expect(v.headline).toMatch(/could not run/);
    expect(v.source).toBe("none");
  });

  it("reports a placement problem first", () => {
    const v = plainVerdict({
      itemTitle: "X",
      score: 0,
      mlEvidence: { placement: { verdict: "EMPTY" }, evidence: {} },
    });
    expect(v.points[0]).toMatch(/could not see any item/);
  });
});
