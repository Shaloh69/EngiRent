/**
 * D-73 verification probe — does the countdown reaching zero ITSELF fetch the
 * successor token, independently of MainScreen's 30s interval poll?
 *
 * Runs against the LIVE kiosk UI server over Tailscale
 * (http://engirent-kiosk:8080), so the bundle under test is the deployed one
 * and the mint is the real `get_qr_token()` in `kiosk_ui/server.py`.
 *
 * WHY A PLAIN 155s WATCH IS NOT A TEST. The token TTL is 90s and the interval
 * is 30s; 90 is a multiple of 30, so on a freshly-mounted screen the expiry
 * trigger and the interval poll land within ~100ms of each other and the
 * PRE-FIX code rotates at the same instant. Measured 2026-09-13: fetches at
 * 3.72 / 33.74 / 63.74 / 93.72s, one token change at 93.86s — a rotation, but
 * indistinguishable from the old behaviour.
 *
 * THE DISCRIMINATOR: reload the page mid-token. The deadline then comes from a
 * partial `expires_in`, so the countdown hits zero OFF the interval grid.
 *   - fix works       -> a fetch and a new QR at ~T+offset, with the interval
 *                        poll still 10-20s away
 *   - fix dead        -> nothing until the next 30s tick; the ring parks empty
 *   - truncation race -> a fetch at T+offset that returns the SAME token with
 *                        expires_in 0, then silence until the interval, because
 *                        setDeadline(now+0) leaves `remaining` at 0 and the
 *                        effect's dep array [isDemo, remaining, refresh] cannot
 *                        re-fire on an unchanged value
 *
 * UI + HTTP only. GET /api/qr-token touches no GPIO; the only `keydown`
 * listener in the kiosk UI is useKioskState.ts:134, which does nothing but
 * reset the inactivity timer (IDLE_MS is 30s, which would otherwise unmount
 * MainScreen long before a 90s token could expire). No door, no actuator —
 * G11 is not engaged.
 *
 * Tokens are recorded as an 8-char sha256 prefix, never in full: the raw token
 * is a live single-use credential and this output gets read back and quoted.
 */
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = process.env.KIOSK_UI ?? "http://engirent-kiosk:8080";
// How far into the 90s token to reload. 50s leaves ~40s of life, which is 10s
// clear of the reload's own T+30 interval poll and 20s short of its T+60 one.
const SOAK_MS = Number(process.env.SOAK_MS ?? 50_000);
const WATCH_MS = Number(process.env.WATCH_MS ?? 75_000);
const OUT = process.argv[2] ?? ".";
mkdirSync(OUT, { recursive: true });

const h = (s) => (s ? createHash("sha256").update(s).digest("hex").slice(0, 8) : null);

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1080, height: 1920 }, // the kiosk's real panel, portrait
  deviceScaleFactor: 1,
});

let t0 = Date.now();
let phase = "soak";
const el = () => ((Date.now() - t0) / 1000).toFixed(2);
const fetches = [];
const samples = [];
const shots = [];

page.on("response", async (r) => {
  if (!r.url().includes("/api/qr-token")) return;
  let body = {};
  try {
    body = await r.json();
  } catch {
    /* ignore */
  }
  const row = { phase, at: el(), token: h(body.token), expires_in: body.expires_in };
  fetches.push(row);
  console.log(`[${phase} ${row.at}s] FETCH token=${row.token} expires_in=${row.expires_in}`);
});

const shoot = async (tag) => {
  const p = `${OUT}/d73-${tag}.png`;
  await page.screenshot({ path: p });
  shots.push({ tag, phase, at: el(), path: p });
  console.log(`[${phase} ${el()}s] shot ${tag}`);
};

const toMain = async () => {
  await page.waitForSelector(".screen-idle", { timeout: 20_000 });
  await page.click(".screen-idle");
  await page.waitForSelector(".qr-fresh-arc", { timeout: 20_000 }); // needs token AND deadline
};

// BlockAssembly covers the whole screen for ~8s during the transition, and a
// shot taken before it detaches photographs the wall rather than the kiosk —
// the exact miscapture recorded in PROGRESS.md's 2026-09-13 E4.2 entry. Only
// the SHOTS wait for it: putting this wait in toMain() once cost a whole run,
// because an inherited 5s token rotated while the wait was still blocking and
// the sampler never saw it.
const settled = async () => {
  await page.waitForSelector(".asm-layer", { state: "detached", timeout: 20_000 });
};

const sample = async () => {
  const s = await page.evaluate(() => {
    const cap = document.querySelector(".qr-refresh");
    const arc = document.querySelector(".qr-fresh-arc");
    const cv = document.querySelector(".qr-canvas-wrap canvas");
    const url = cv ? cv.toDataURL() : null;
    return {
      caption: cap ? cap.textContent.trim() : null,
      dashoffset: arc ? getComputedStyle(arc).strokeDashoffset : null,
      screen: document.querySelector(".screen")?.className ?? null,
      // fingerprint of the rendered QR pixels — proof independent of the
      // network trace that the code a person would scan actually changed
      qrpx: url ? `${url.length}:${url.slice(-24)}` : null,
    };
  });
  s.phase = phase;
  s.at = el();
  samples.push(s);
  return s;
};

// Phase 1 — soak. Mint a token and sit on the main screen ~50s so the next
// page load inherits a partially-spent one.
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await toMain();
await settled();
console.log(`[soak ${el()}s] main up; soaking ${SOAK_MS / 1000}s to spend part of the token`);
let lastKey = Date.now();
while (Date.now() - t0 < SOAK_MS) {
  if (Date.now() - lastKey > 15_000) {
    await page.keyboard.press("Shift");
    lastKey = Date.now();
  }
  await sample();
  await page.waitForTimeout(1000);
}

// Phase 2 — reload. The deadline now comes from a partial expires_in, so the
// countdown's zero falls off the 30s interval grid.
phase = "watch";
t0 = Date.now();
await page.reload({ waitUntil: "domcontentloaded" });
await toMain();
const first = fetches.filter((f) => f.phase === "watch")[0];
console.log(
  `[watch ${el()}s] reloaded; inherited expires_in=${first?.expires_in}s -> ` +
    `countdown hits 0 at ~T+${first?.expires_in}s, interval polls at T+30 and T+60`,
);

lastKey = Date.now();
let shotInherited = false;
let zeroRun = 0;
let maxZeroRun = 0;
let zeroStart = null;
let zeroEnd = null;
let shotZero = false;
let shotAfter = false;
while (Date.now() - t0 < WATCH_MS) {
  if (Date.now() - lastKey > 15_000) {
    await page.keyboard.press("Shift");
    lastKey = Date.now();
    console.log(`[watch ${el()}s] keep-awake keypress`);
  }
  const s = await sample();
  // First shot as soon as the transition wall is gone, not before it.
  if (!shotInherited && !(await page.$(".asm-layer"))) {
    await shoot("w000-inherited");
    shotInherited = true;
  }
  const isZero = s.caption === "Fetching a fresh code…" || /refreshes in 0s/.test(s.caption ?? "");
  if (isZero) {
    if (zeroRun === 0) zeroStart = s.at;
    zeroRun += 1;
    zeroEnd = s.at;
    maxZeroRun = Math.max(maxZeroRun, zeroRun);
    if (!shotZero) {
      await shoot("w0xx-at-zero");
      shotZero = true;
    }
  } else {
    if (shotZero && !shotAfter) {
      await shoot("w0xx-after-rotation");
      shotAfter = true;
    }
    zeroRun = 0;
  }
  await page.waitForTimeout(500);
}
await shoot("w075-end");

// Verdict
const watchFetches = fetches.filter((f) => f.phase === "watch");
const watchSamples = samples.filter((s) => s.phase === "watch");
const qrChanges = [];
for (let i = 1; i < watchSamples.length; i++) {
  if (watchSamples[i].qrpx && watchSamples[i].qrpx !== watchSamples[i - 1].qrpx) {
    qrChanges.push({
      at: watchSamples[i].at,
      from: watchSamples[i - 1].caption,
      to: watchSamples[i].caption,
    });
  }
}
const inherited = first?.expires_in ?? null;
// An interval poll lands within a second of a 30s multiple from the reload; a
// fetch anywhere else can only have come from the countdown hitting zero.
const offGrid = watchFetches.filter((f) => {
  const t = Number(f.at);
  return t > 5 && Math.abs(t - 30 * Math.round(t / 30)) > 2;
});
const rotationFetch = watchFetches.find((f) => f.token && f.token !== first?.token);

// The truncation race, if it fires: server.py:111 is `int(expiry - now)`, which
// understates the remaining life by the fractional second, so the client's zero
// can land just BEFORE the real expiry and the refetch returns the SAME token
// with expires_in 0. Recovery is not guaranteed by design — it happens because
// setDeadline(now+0) is compared against a lagging 1s tick, so `remaining`
// computes to ceil(<1s) = 1 rather than 0, the dep array changes, and the
// effect re-fires on the next tick. Measure it rather than assume it.
const staleZero = watchFetches.find((f) => f.expires_in === 0 && f.token === first?.token);
const recoveryS =
  staleZero && rotationFetch ? +(Number(rotationFetch.at) - Number(staleZero.at)).toFixed(2) : null;

// The rendered-QR check only means something if the sampler was running across
// the rotation; with a small inherited TTL the ~8s BlockAssembly transition can
// swallow it, and that is a gap in coverage, not a failure of the product.
const sampledAcrossRotation =
  rotationFetch != null &&
  watchSamples.some((s) => Number(s.at) < Number(rotationFetch.at)) &&
  watchSamples.some((s) => Number(s.at) > Number(rotationFetch.at));

const verdict = !rotationFetch
  ? "FAIL - no successor token arrived in the watch window at all"
  : offGrid.length === 0
    ? "FAIL - every watch-phase fetch sits on the 30s interval grid; the expiry trigger did not fire"
    : Math.abs(Number(rotationFetch.at) - inherited) > 3 + (recoveryS ?? 0)
      ? "INCONCLUSIVE - a successor arrived, but not when the countdown reached zero; read the trace"
      : sampledAcrossRotation && qrChanges.length === 0
        ? "FAIL - a successor token arrived but the rendered QR never changed"
        : `PASS - a NEW token arrived off the interval grid when the countdown reached zero` +
          (staleZero ? ` (truncation race fired and self-healed in ${recoveryS}s)` : "") +
          (sampledAcrossRotation ? "; rendered QR changed" : "; rendered QR not sampled across it");

const report = {
  base: BASE,
  inherited_expires_in: inherited,
  fetches,
  watch_off_grid_fetches: offGrid,
  rendered_qr_changes: qrChanges,
  sampled_across_rotation: sampledAcrossRotation,
  truncation_race: staleZero ? { fired_at: staleZero.at, recovered_after_s: recoveryS } : null,
  zero_window: { samples: maxZeroRun, seconds: maxZeroRun * 0.5, from: zeroStart, to: zeroEnd },
  screens_seen: [...new Set(samples.map((s) => s.screen))],
  verdict,
  shots,
  samples,
};
writeFileSync(`${OUT}/d73-report.json`, JSON.stringify(report, null, 2));

console.log("\n===== D-73 RESULT =====");
console.log("inherited expires_in:", inherited, `s  (countdown zero expected at T+${inherited}s)`);
console.log(
  "watch-phase fetches: ",
  watchFetches.map((f) => `${f.at}s:${f.token}:${f.expires_in}`).join("  |  "),
);
console.log("off-grid fetches:    ", offGrid.map((f) => `${f.at}s:${f.token}`).join("  |  ") || "(none)");
console.log("rendered QR changed: ", qrChanges.length, "time(s)", JSON.stringify(qrChanges));
console.log("sampled across it:   ", sampledAcrossRotation);
console.log(
  "truncation race:     ",
  staleZero ? `FIRED at ${staleZero.at}s, self-healed after ${recoveryS}s` : "did not fire",
);
console.log(
  "longest zero window: ",
  report.zero_window.seconds,
  "s",
  zeroStart ? `(${zeroStart}s -> ${zeroEnd}s)` : "",
);
console.log("screens seen:        ", report.screens_seen.join(", "));
console.log("VERDICT:", verdict);
await browser.close();
