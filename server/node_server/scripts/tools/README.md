# scripts/tools — Register 3 coverage tooling

`docs/PROGRESS.md`'s Register 3 says its coverage counts are **computed, not
added up by hand**. These are the scripts that compute them, kept in the repo so
that claim stays checkable and the register can be regenerated after new tests
land.

## Why it works this way

`PROGRESS.md` warns: **do not infer endpoint coverage from a suite's title.**
Four wrong assertions were written earlier in E1 by reasoning from names and
endpoint *lists* instead of routes. So:

```bash
node scripts/tools/extract-endpoint-calls.mjs scripts out.json
```

parses every `e2e-*.mjs` and pulls out the paths it **actually calls** —
`jreq("/x")`, `call("GET","/x")`, and raw `fetch(\`${API}/x\`)` — normalising
`${id}` to `:p`. Anything it cannot resolve statically is printed under
**UNRESOLVED** rather than silently dropped; four suites build paths from
variables and their endpoint tables were transcribed by hand into the second
script.

```bash
node scripts/tools/build-register3.mjs register3.md
```

joins that against the 93 rows from the route files and emits the register
section, with the summary counts computed. Paste the output over the table in
`docs/PROGRESS.md` between the "Computed coverage" line and `## BACKLOG`.

## Keeping it honest

- **`HAPPY` is hand-maintained** — when you add a suite, add its rows. The
  extractor tells you what it calls; it cannot tell you whether the call
  *asserts* anything, which is the thing that matters.
- The `m:` prefix marks a **manualOnly** suite, excluded from unattended runs.
  Those rows are weaker evidence and the register says so.
- A row is only `✓` for happy path if a suite makes the call **and asserts on
  the result**. A 200 nobody looked at is not coverage.
