/**
 * D-18 regression tests.
 *
 * THE DEFECT. When `runMlVerification` could not download the reference images,
 * it returned a bare `{ decision: "PENDING", confidence: 0 }` and never called
 * the ML service. PENDING is a *legitimate* documented outcome — the 60-84
 * manual-review band — so a queue full of these looked completely normal.
 * After a Cloudflare tunnel rotation every item's images 404'd (D-17), so
 * **every deposit and return silently routed to a human**, with a confidence
 * score that read as real and one `logger.warn` line as the only trace.
 *
 * WHY THIS TEST DID NOT EXIST UNTIL NOW. The function was at module scope in
 * `index.ts`, which starts an HTTP server and socket.io on import — importing
 * it from a test booted the application. Extracted to its own service on
 * 2026-09-06 specifically so this could be written. The logic was moved
 * verbatim; if these tests pass, the move was faithful.
 *
 * The distinction under test is not "does it return PENDING" — it should, and
 * failing closed is correct. It is **"can an infrastructure failure still be
 * mistaken for a real verdict."**
 */

jest.mock("axios");
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import axios from "axios";
import logger from "../../utils/logger";
import { runMlVerification, resolveMediaUrl } from "../mlVerificationService";

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedLogger = logger as unknown as {
  warn: jest.Mock;
  error: jest.Mock;
};

const ORIG = ["http://dead-host.example/media/items/b1/listing-1.jpg"];
const KIOSK = ["http://dead-host.example/media/items/b1/kiosk-1.jpg"];

/** A successful image download. */
const imageOk = () =>
  Promise.resolve({ data: new ArrayBuffer(8) } as never);
/** A failed image download — what a rotated hostname produces. */
const imageFails = () => Promise.reject(new Error("ENOTFOUND"));

beforeEach(() => {
  jest.clearAllMocks();
});

describe("D-18 — an infrastructure failure must not look like a real verdict", () => {
  it("marks the outcome unavailable when NO reference image can be downloaded", async () => {
    mockedAxios.get.mockImplementation(imageFails);

    const result = await runMlVerification(ORIG, KIOSK, 1, null);

    expect(result.unavailable).toBe(true);
    expect(result.unavailableReason).toBe("reference_images_unavailable");
  });

  it("still fails CLOSED to PENDING — never auto-approves on missing evidence", async () => {
    mockedAxios.get.mockImplementation(imageFails);

    const result = await runMlVerification(ORIG, KIOSK, 1, null);

    // The point of the fix was never to change this. A human must still look.
    expect(result.decision).toBe("PENDING");
    expect(result.confidence).toBe(0);
  });

  it("does NOT call the ML service when the references are unavailable", async () => {
    mockedAxios.get.mockImplementation(imageFails);

    await runMlVerification(ORIG, KIOSK, 1, null);

    // Proves the pipeline genuinely never ran — which is exactly why the old
    // bare PENDING was a lie rather than a low score.
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("logs at ERROR, not warn — the silence was half the defect", async () => {
    mockedAxios.get.mockImplementation(imageFails);

    await runMlVerification(ORIG, KIOSK, 1, null);

    expect(mockedLogger.error).toHaveBeenCalledTimes(1);
    const msg = String(mockedLogger.error.mock.calls[0][0]);
    // The counts have to be in the message; "something failed" is not
    // actionable at 3am when a locker is holding someone's theodolite.
    expect(msg).toContain("0/1");
    expect(msg).toMatch(/infrastructure failure/i);
  });

  it("distinguishes kiosk-side unavailability from reference-side", async () => {
    // References download fine; the kiosk's own captures do not.
    mockedAxios.get.mockImplementation((url: string) =>
      String(url).includes("kiosk") ? imageFails() : imageOk(),
    );

    const result = await runMlVerification(ORIG, KIOSK, 1, null);

    expect(result.unavailable).toBe(true);
    expect(result.unavailableReason).toBe("kiosk_images_unavailable");
  });
});

describe("the happy path stays untouched", () => {
  it("calls the ML service and passes its verdict through unflagged", async () => {
    mockedAxios.get.mockImplementation(imageOk);
    mockedAxios.post.mockResolvedValue({
      data: {
        decision: "APPROVED",
        confidence: 91.4,
        method_scores: { traditional: 0.9 },
        ocr: null,
      },
    } as never);

    const result = await runMlVerification(ORIG, KIOSK, 2, { cached: true });

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(result.decision).toBe("APPROVED");
    expect(result.confidence).toBe(91.4);
    // The absence of this flag is what lets a caller trust the score.
    expect(result.unavailable).toBeUndefined();
  });

  it("a genuine 60-84 PENDING is NOT flagged unavailable", async () => {
    mockedAxios.get.mockImplementation(imageOk);
    mockedAxios.post.mockResolvedValue({
      data: { decision: "PENDING", confidence: 72, method_scores: {}, ocr: null },
    } as never);

    const result = await runMlVerification(ORIG, KIOSK, 1, null);

    // This is the assertion that gives the flag its meaning: both outcomes say
    // PENDING, and only one of them means "nobody actually compared anything".
    expect(result.decision).toBe("PENDING");
    expect(result.unavailable).toBeUndefined();
  });
});

describe("D-17 — a dead baked-in hostname heals on read", () => {
  it("rebuilds a legacy absolute item URL against the current host", () => {
    const resolved = resolveMediaUrl(
      "https://some-dead-tunnel.trycloudflare.com/media/items/batch7/listing-2.jpg",
    );

    // The stored hostname must not survive; the path must.
    expect(resolved).not.toContain("some-dead-tunnel");
    expect(resolved).toContain("items/batch7/listing-2.jpg");
  });

  it("leaves a non-item media path alone rather than guessing", () => {
    const stored = "users/abc/face.jpg";
    expect(resolveMediaUrl(stored)).toBe(stored);
  });
});
