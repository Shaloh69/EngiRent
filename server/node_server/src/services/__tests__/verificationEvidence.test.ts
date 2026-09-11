import fs from "fs";
import path from "path";
import {
  ML_UNREACHABLE,
  mlUnreachableResult,
  verificationEvidenceFields,
} from "../verificationEvidence";

/**
 * D-65 regression. "No evidence" and "evidence of no match" used to persist as
 * byte-identical rows (`confidenceScore: 0, decision: PENDING,
 * status: MANUAL_REVIEW`), which is why A-3's two zero-score rows cannot be
 * interpreted at all. These tests pin both halves: the fields are derived
 * correctly, AND every verification write site carries them.
 */
describe("D-65 — verification evidence fields", () => {
  it("fails closed when the ML service is unreachable, and says so", () => {
    const r = mlUnreachableResult();
    // Fail closed — a human must look. Never auto-approve on missing evidence.
    expect(r.decision).toBe("PENDING");
    expect(r.confidence).toBe(0);
    expect(r.unavailable).toBe(true);
    expect(r.unavailableReason).toBe("ml_unreachable");
    expect(ML_UNREACHABLE).toBe("ml_unreachable");
  });

  it("persists an ML-unreachable run as unavailable with its reason", () => {
    expect(verificationEvidenceFields(mlUnreachableResult())).toEqual({
      unavailable: true,
      unavailableReason: "ml_unreachable",
    });
  });

  it.each([
    "reference_images_unavailable",
    "kiosk_images_unavailable",
  ])("carries the pipeline's own reason: %s", (reason) => {
    expect(
      verificationEvidenceFields({
        unavailable: true,
        unavailableReason: reason,
      }),
    ).toEqual({ unavailable: true, unavailableReason: reason });
  });

  it("persists a normal scored run as available, with no reason", () => {
    // What the ML service actually returns: neither field is present.
    expect(verificationEvidenceFields({} as never)).toEqual({
      unavailable: false,
      unavailableReason: null,
    });
    expect(
      verificationEvidenceFields({ unavailable: false } as never),
    ).toEqual({ unavailable: false, unavailableReason: null });
  });

  it("never records a reason on an available row", () => {
    // A stale reason on a scored row would be worse than none — it would put a
    // real comparison into the excluded-from-calibration bucket.
    expect(
      verificationEvidenceFields({
        unavailable: false,
        unavailableReason: "reference_images_unavailable",
      }),
    ).toEqual({ unavailable: false, unavailableReason: null });
  });
});

/**
 * The failure this guards is "one of the four write sites was missed" — the one
 * nobody exercises until it matters. Mutation check: delete
 * `...verificationEvidenceFields(mlResult)` from any single
 * `prisma.verification.create` payload in index.ts and this goes red.
 */
describe("D-65 — every verification write site carries the evidence fields", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "index.ts"),
    "utf8",
  );

  /** The `{ ... }` argument of every `prisma.verification.create(...)` call. */
  function createPayloads(text: string): string[] {
    const marker = "prisma.verification.create(";
    const out: string[] = [];
    let i = text.indexOf(marker);
    while (i !== -1) {
      let depth = 0;
      let j = i + marker.length;
      const start = j;
      for (; j < text.length; j++) {
        const c = text[j];
        if (c === "(" || c === "{") depth++;
        else if (c === ")" || c === "}") {
          depth--;
          if (depth === 0) break;
        }
      }
      out.push(text.slice(start, j + 1));
      i = text.indexOf(marker, j);
    }
    return out;
  }

  const payloads = createPayloads(src);

  it("finds every write site (4 as of 2026-09-11 — deposit and return, ×2 each)", () => {
    expect(payloads.length).toBe(4);
  });

  it.each(payloads.map((p, n) => [n + 1, p]))(
    "write site %i spreads verificationEvidenceFields",
    (_n, payload) => {
      expect(payload).toContain("verificationEvidenceFields(mlResult)");
    },
  );

  it("tags the ML-unreachable catch path at both flows", () => {
    const hits = src.split("mlResult = mlUnreachableResult();").length - 1;
    expect(hits).toBe(2);
  });
});
