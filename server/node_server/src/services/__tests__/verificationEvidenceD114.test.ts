/**
 * D-114: the v2 AI's reasoning is kept on the Verification row so an admin can
 * see why a score is what it is. The first physical test of v2 scored a wrong
 * tool 77.87 and nothing stored said why.
 */
import {
  buildMlEvidence,
  mlUnreachableResult,
  verificationEvidenceFields,
} from "../verificationEvidence";
import type { MlVerificationResult } from "../mlVerificationService";

const v2Answer: MlVerificationResult = {
  decision: "RETRY",
  confidence: 77.87,
  method_scores: { deep_learning_aggregated: 62.54 },
  ocr: null,
  mode: "fast",
  message: "Part of the item is outside the camera's view.",
  pipeline: "v2",
  placement: { verdict: "TRUNCATED", edges: ["top"], per_frame: ["TRUNCATED", "TRUNCATED", "OK"] },
  reposition: true,
  quality_blocked: false,
  evidence: { dino_max: 0.6254, sem_bc: 0.9, stage_set: "S2" },
  stage_seconds: { locker_frames: 3.2, compare: 0.01 },
  elapsed_seconds: 3.4,
};

describe("D-114 buildMlEvidence", () => {
  it("keeps the placement verdict, reposition flag, evidence and stage times of a v2 answer", () => {
    const e = buildMlEvidence(v2Answer)!;
    expect(e.pipeline).toBe("v2");
    expect(e.decision).toBe("RETRY");
    expect(e.confidence).toBe(77.87);
    expect(e.reposition).toBe(true);
    expect((e.placement as { verdict: string }).verdict).toBe("TRUNCATED");
    expect((e.evidence as { sem_bc: number }).sem_bc).toBe(0.9);
    expect(e.stageSeconds).toEqual({ locker_frames: 3.2, compare: 0.01 });
    expect(e.elapsedSeconds).toBe(3.4);
  });

  it("returns null for a v1 answer: nothing that merely looks like reasoning", () => {
    const { pipeline: _p, ...v1 } = v2Answer;
    expect(buildMlEvidence(v1)).toBeNull();
  });

  it("returns null for the synthetic 'ML unreachable' result", () => {
    expect(buildMlEvidence(mlUnreachableResult())).toBeNull();
  });

  it("defaults the booleans a v2 answer left out to false", () => {
    const e = buildMlEvidence({ ...v2Answer, reposition: undefined, quality_blocked: undefined })!;
    expect(e.reposition).toBe(false);
    expect(e.qualityBlocked).toBe(false);
  });
});

describe("D-114 verificationEvidenceFields", () => {
  it("adds mlEvidence for a v2 answer and keeps the D-65 fields as before", () => {
    const f = verificationEvidenceFields(v2Answer);
    expect(f.unavailable).toBe(false);
    expect(f.unavailableReason).toBeNull();
    expect(f.mlEvidence).toBeDefined();
  });

  it("leaves mlEvidence undefined (column stays null) for an unreachable ML service, and still marks it unavailable", () => {
    const f = verificationEvidenceFields(mlUnreachableResult());
    expect(f.unavailable).toBe(true);
    expect(f.mlEvidence).toBeUndefined();
  });
});
