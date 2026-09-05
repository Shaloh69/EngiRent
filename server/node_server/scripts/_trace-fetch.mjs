/**
 * Records every HTTP request an e2e suite makes, so endpoint coverage can be
 * measured instead of inferred.
 *
 * `docs/PROGRESS.md`'s Register 3 has 93 endpoint rows and the phase has to
 * fill in each row's test status. Reading the suites and guessing which routes
 * they touch is exactly the mistake this project keeps making — the original
 * defect doc got four of five analyses wrong by reasoning from an endpoint
 * *list* rather than from the routes. So: observe it.
 *
 * Loaded via `NODE_OPTIONS=--import <this file>` by `e2e-all.mjs --trace`, it
 * wraps `globalThis.fetch` before the suite's own code runs and appends one
 * JSON line per request to `$E2E_TRACE_FILE`. It changes nothing else: the
 * original fetch is called with the original arguments and its result is
 * returned untouched, and a failure to write the trace can never fail a suite.
 *
 * Not loaded, or `E2E_TRACE_FILE` unset → this module does nothing at all.
 */
import { appendFileSync } from "node:fs";

const TRACE = process.env.E2E_TRACE_FILE;
const SUITE = process.env.E2E_TRACE_SUITE ?? "unknown";

if (TRACE && typeof globalThis.fetch === "function") {
  const original = globalThis.fetch;

  globalThis.fetch = async function tracedFetch(input, init) {
    let method = "GET";
    let url = "";
    try {
      url = typeof input === "string" ? input : (input?.url ?? String(input));
      method = (init?.method ?? input?.method ?? "GET").toUpperCase();
    } catch {
      /* never let tracing break the call */
    }

    let status = 0;
    try {
      const res = await original.call(this, input, init);
      status = res.status;
      return res;
    } finally {
      try {
        appendFileSync(
          TRACE,
          JSON.stringify({ suite: SUITE, method, url, status }) + "\n",
        );
      } catch {
        /* a trace that cannot be written is not a test failure */
      }
    }
  };
}
