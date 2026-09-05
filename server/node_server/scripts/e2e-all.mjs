/**
 * E1 — one command runs the suite.
 *
 *   node scripts/e2e-all.mjs              # everything runnable unattended
 *   node scripts/e2e-all.mjs --safe       # only the suites that create no rows
 *   node scripts/e2e-all.mjs --list       # what would run, and why
 *   node scripts/e2e-all.mjs --only=kiosk-trust,webhook-signature
 *   node scripts/e2e-all.mjs --trace=e2e-trace.jsonl   # record every request
 *
 * Env: API_BASE_URL (…/api/v1) and whatever the individual suites need —
 * ADMIN_EMAIL/ADMIN_PASSWORD, STUDENT_EMAIL/STUDENT_PASSWORD,
 * RATE_LIMIT_BYPASS_SECRET, KIOSK_SHARED_SECRET. Everything in this process's
 * environment is passed straight through to each child.
 *
 * Why sequential, never parallel
 * ------------------------------
 * These are real HTTP suites against one deployment. Running them at once
 * would (a) trip the 100-request / 15-minute rate limit far faster, and (b)
 * race on shared rows — several suites register accounts and create items.
 *
 * Rate limiting is the practical constraint on running everything at once:
 * the full set is several hundred requests against a 100-per-15-minutes
 * window. Either export `RATE_LIMIT_BYPASS_SECRET` (the value in the server's
 * `.env`; every use is logged at warn), or run this on the server itself
 * against `http://localhost:5000/api/v1`.
 *
 * `needsDb: true` means the suite imports `@prisma/client` and talks to MySQL
 * **directly**, not only through the API — nine of them do, for setup and
 * cleanup. Those cannot run from a developer machine at all, because
 * `DATABASE_URL` points at `localhost:3307` on the server. **Run this on the
 * server**, from the repo's `server/node_server` directory there, with
 * `API_BASE_URL=http://localhost:5000/api/v1`. `--safe` is the subset that
 * runs from anywhere.
 *
 * `mutates: true` means the suite creates real rows on whatever deployment it
 * is pointed at. Most clean up after themselves; `full-lifecycle` deliberately
 * leaves its rental and transactions behind as an audit trail. `--safe` skips
 * all of them, which is the right mode when the database is being kept clean
 * for a manual test run.
 */
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
// `resolve` is aliased: the Promise executor below has its own `resolve`,
// and shadowing it silently resolved the promise with a path string.
import { dirname, join, resolve as resolvePath } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

const SUITES = [
  // ── read-only / rejection-only: safe against any deployment ──────────────
  { name: "auth-matrix", file: "e2e-auth-matrix.mjs", mutates: false,
    what: "401 / 403 across the API, plus a public-surface control" },
  { name: "kiosk-trust", file: "e2e-kiosk-trust.mjs", mutates: false,
    what: "attacks the kiosk session trust boundary (HTTP + socket)" },
  { name: "webhook-signature", file: "e2e-webhook-signature.mjs", mutates: false,
    what: "forged PayMongo webhooks; asserts a real transaction did not move" },
  { name: "defect-regressions", file: "e2e-defect-regressions.mjs", mutates: false,
    what: "D-1 login shape, D-15 malformed-body 400s, D-17 media URLs" },

  // ── create real rows; most clean up after themselves ─────────────────────
  { name: "coverage-sweep", file: "e2e-coverage-sweep.mjs", mutates: true,
    what: "Register 3's safe happy-path gaps: account lifecycle, read-only student + admin surface, retired-endpoint 410s. Creates one throwaway account and deletes it" },
  { name: "self-action", file: "e2e-self-action.mjs", mutates: true,
    what: "self-rental guard + the derived-counterparty guards behind it" },
  { name: "my-listings", file: "e2e-my-listings.mjs", mutates: true, needsDb: true,
    what: "owner's item list, edit, delete" },
  { name: "availability", file: "e2e-availability.mjs", mutates: true, needsDb: true,
    what: "date-based availability and booked-dates" },
  { name: "messaging", file: "e2e-messaging.mjs", mutates: true, needsDb: true,
    what: "rental conversation, participant gating, admin read access" },
  { name: "feedback", file: "e2e-feedback.mjs", mutates: true, needsDb: true,
    what: "feedback submit, mine, admin triage" },
  { name: "item-moderation", file: "e2e-item-moderation.mjs", mutates: true, needsDb: true,
    what: "admin item edit, review deletion" },
  { name: "listing-video", file: "e2e-listing-video.mjs", mutates: true, needsDb: true,
    what: "listing video upload and playback URLs" },
  { name: "trust-safety", file: "e2e-trust-safety.mjs", mutates: true, needsDb: true,
    what: "reports, disputes, admin settle" },
  { name: "verification", file: "e2e-verification.mjs", mutates: true, needsDb: true,
    manualOnly: "needs a real face.jpg path as argv[2] (the ML service rejects " +
      "anything that is not a face), and it enrols biometrics for accounts it " +
      "then deletes — see D-12",
    what: "ID + face submission and admin approval" },
  { name: "enterprise-hygiene", file: "e2e-enterprise-hygiene.mjs", mutates: true, needsDb: true,
    what: "audit log, admin creation, app-config, bulk actions" },

  // ── needs an argument, so never run unattended ───────────────────────────
  { name: "full-lifecycle", file: "e2e-full-lifecycle.mjs", mutates: true, needsDb: true,
    manualOnly: "needs a real face image path as argv[2], and leaves its " +
      "rental + transactions behind on purpose",
    what: "two accounts, verification, item, rental, payment, kiosk deposit" },
];

const args = process.argv.slice(2);
const safeOnly = args.includes("--safe");
/** `--trace` records every request each suite makes to a JSONL file, so
 *  Register 3's per-endpoint coverage can be measured rather than guessed.
 *  See `_trace-fetch.mjs`. */
const traceArg = args.find((a) => a.startsWith("--trace"));
const tracePath = traceArg
  ? (traceArg.includes("=") ? traceArg.slice(traceArg.indexOf("=") + 1) : "e2e-trace.jsonl")
  : null;
const listOnly = args.includes("--list");
const onlyArg = args.find((a) => a.startsWith("--only="));
const only = onlyArg ? onlyArg.slice("--only=".length).split(",").map((s) => s.trim()) : null;

function selected() {
  return SUITES.filter((s) => {
    if (only) return only.includes(s.name);
    if (s.manualOnly) return false;
    if (safeOnly && s.mutates) return false;
    return true;
  });
}

/** Suites print their totals in three different shapes. Read what we can, and
 *  fall back to the exit code — which every suite sets correctly. */
function parseCounts(output) {
  let m = output.match(/(\d+)\s+passed,\s+(\d+)\s+failed/);
  if (m) return { pass: +m[1], fail: +m[2] };
  m = output.match(/pass\s+(\d+)\s+fail\s+(\d+)/);
  if (m) return { pass: +m[1], fail: +m[2] };
  return null;
}

function run(suite) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [join(HERE, suite.file)], {
      env: tracePath
        ? {
            ...process.env,
            E2E_TRACE_FILE: resolvePath(tracePath),
            E2E_TRACE_SUITE: suite.name,
            // --import runs before the suite's own module graph, which is the
            // only way to wrap fetch ahead of the first call.
            NODE_OPTIONS:
              `${process.env.NODE_OPTIONS ?? ""} --import ${pathToFileURL(join(HERE, "_trace-fetch.mjs")).href}`.trim(),
          }
        : process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => {
      resolve({
        suite,
        code,
        out,
        counts: parseCounts(out),
        seconds: ((Date.now() - started) / 1000).toFixed(1),
      });
    });
  });
}

(async () => {
  const list = selected();

  if (listOnly) {
    console.log("suite                 mutates  db   what");
    for (const s of SUITES) {
      const flag = s.manualOnly ? "manual " : s.mutates ? "yes    " : "no     ";
      const db = s.needsDb ? "yes  " : "no   ";
      console.log(`${s.name.padEnd(21)} ${flag} ${db} ${s.what}`);
      if (s.manualOnly) console.log(`${" ".repeat(22)}   (skipped: ${s.manualOnly})`);
    }
    return;
  }

  if (tracePath) console.log(`tracing every request to ${resolvePath(tracePath)}`);
  console.log(
    `running ${list.length} suite(s) against ${process.env.API_BASE_URL ?? "http://localhost:5000/api/v1"}` +
      (safeOnly ? "  [--safe: no rows will be created]" : "") +
      (process.env.RATE_LIMIT_BYPASS_SECRET ? "  [rate-limit bypass in use]" : "") +
      "\n",
  );

  const results = [];
  for (const suite of list) {
    process.stdout.write(`  ${suite.name.padEnd(21)} … `);
    const r = await run(suite);
    results.push(r);
    const counts = r.counts ? `${r.counts.pass} pass / ${r.counts.fail} fail` : "no summary line";
    console.log(`${r.code === 0 ? "OK  " : "FAIL"}  ${counts}  (${r.seconds}s)`);
  }

  const failed = results.filter((r) => r.code !== 0);

  console.log("\n" + "=".repeat(72));
  const totals = results.reduce(
    (acc, r) => ({
      pass: acc.pass + (r.counts?.pass ?? 0),
      fail: acc.fail + (r.counts?.fail ?? 0),
    }),
    { pass: 0, fail: 0 },
  );
  console.log(
    `${results.length - failed.length}/${results.length} suites green` +
      `  ·  ${totals.pass} assertions passed, ${totals.fail} failed` +
      (results.some((r) => !r.counts) ? "  (some suites print no totals — exit code used)" : ""),
  );

  for (const r of failed) {
    console.log(`\n${"-".repeat(72)}\n${r.suite.name} — exit ${r.code}\n${"-".repeat(72)}`);
    // The tail is where every suite prints its failure list.
    console.log(r.out.split("\n").slice(-40).join("\n"));
  }

  process.exitCode = failed.length === 0 ? 0 : 1;
})();
