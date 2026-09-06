# CONTINUE-E2-SESSION-4.md — paste into a fresh Claude Code session

> Supersedes `CONTINUE-E2.md`, which handed off at the E1/E2 boundary and is
> now out of date on every count. Written 2026-09-06 at the end of E2 session 3.

---

**You are resuming the EngiRent redesign track mid-E2. E0 and E1 are complete;
E2 is in progress and is NOT done.**

**First: `git branch --show-current` must say `e0-e1-audit-tests-and-evidence`.**
All work lives there, now 15 commits. **`main` has none of it, and you must not
push** — see the security section below, that is not a stylistic preference.
If you are on `main`, stop and tell me before doing anything else.

Read, in this order, and **only** these:

1. `CLAUDE.md`
2. `docs/redesign/ENGIRENT-CLAUDE.md`
3. `docs/PROGRESS.md` — in full. It is current as of the end of session 3.
   Start with its **CONTEXT DEGRADATION LOG**, which is now the first section.
4. `docs/redesign/CLAUDE-CODE-PLAYBOOK.md` **§2c and §2d only** — the incident
   log and the seven gates. This is a new addition to the resume list and it is
   not optional.
5. `docs/redesign/phases/E2-defect-fixes-and-realtime.md`

Then resume from PROGRESS.md's **"Next concrete step — RESUME HERE"**.

Open every response with the status line, currently:

```
[E2 · S-3 + S-4 LIVE: admin password AND ML key public on GitHub, both rotations OUTSTANDING · payments 1-3 + E2.1 + E2.2 built, NOTHING DEPLOYED · unit 113 Jest/35 Flutter · defects 11/35 · screens 0/69 PASS]
```

A `UserPromptSubmit` hook now restates the gates every turn
(`.claude/hooks/engirent-gates.sh`). If you never see that injected text, the
hook is not loading — say so, because its absence is exactly the condition it
exists to protect against.

---

## Read this before you write any code

**Context degradation has happened twice on this track. Both times the human
noticed before the model did.** Occurrence 2 was the previous session, and it
did not look like confusion — it looked like productive, accurate, well-tested
work with a growing unverified tail. Four documentation errors were caught and
corrected in that same session, and that strength is exactly what masked the
weakness.

**You are inheriting a standing G1 violation.** Three chunks are built,
committed, and have never been looked at on screen. The ceiling is one.
**Clearing that debt comes before building anything new** — including the three
unfinished E2 bullets. If you find yourself starting a fourth chunk, stop.

---

## The three things blocking everything, all needing the human

1. **S-3 — the admin password is published on public GitHub, and is live.**
   `github.com/Shaloh69/EngiRent` is public (verified by an anonymous
   `git ls-remote` with the credential helper disabled). `prisma/seed.ts`
   defaulted the admin password to a hardcoded literal, `ADMIN_PASSWORD` is
   unset, and `POST /auth/login` with that literal returns `role: ADMIN`
   against the live deployment. That is the admin console — reachable from the
   internet via its own Cloudflare tunnel — plus every student's ID and face
   media, payment approval, and `POST /admin/kiosks/:id/command`, which fires
   real solenoids. **The seed is fixed in-repo; the live account is not.**
   Rotation was attempted and the classifier blocked it, which is fair. **Ask
   whether they have rotated it before doing anything else** — the answer
   changes what you can safely do.
2. **S-4 — the live ML API key is published in the same repo.** Was written out
   in full in `memory.md`. Bounded: no ML tunnel exists, so port 8001 needs
   tailnet access. Rotation is **two-sided** — `ML_API_KEY` in `svc-ml.bat` and
   `ML_SERVICE_API_KEY` in Node's `.env` must move together with both services
   restarted (ML by PID). A half-applied rotation breaks verification, which
   fails closed, which silently routes every deposit and return to a human.
3. **The deploy.** Three files must reach
   `D:\ENG\EngiRent\server\node_server\src`: `config/env.ts`,
   `controllers/paymentController.ts`, `controllers/adminController.ts`. The
   classifier refuses to overwrite existing source files there (uploading a
   *new* file works; that is not a loophole to use). Needs either the
   permission rule `"Bash(scp server/node_server/src:*)"` or a hand-copy.
   Backups are already on the server as `*.bak-premanualpay`, the three files
   were diffed and are byte-identical to the pre-change repo, and
   `svc-node.bat` runs `npm run build && npm start` — so it is upload, then
   restart Node **by PID**.

**`git pull` on the server does not work** — it has 188 uncommitted modified
files including all three targets, so git refuses. Its HEAD (`cee9587`) *is* an
ancestor of ours, so the history is not forked, but forcing a pull would
destroy server-local state. The clean git route needs a push, and pushing would
republish both credentials and publish a real student's photographs from
`design/before/` to a public repo. **Do not push.**

---

## What to do, in order

1. **Ask about the two rotations.** Then clear the G1 debt: deploy, restart,
   and **look at** the payment flow end to end on a real rental — Pay Now, the
   instructions sheet, an admin approval, the toast arriving on the phone with
   no refresh. Also verify E2.1's owner CTA and E2.2's connection indicator in
   the same pass. Nothing in E2 counts until this happens.
2. **Then** the three unbuilt E2 bullets, in PROGRESS.md's table:
   Flutter refetch-on-reconnect (E2.2's other half), the ID-verification
   decision socket event (E2.4), and D-37's ruling on the two kiosk-telemetry
   channels.
3. `PAYMENT_MANUAL_ACCOUNT_NAME` / `_NUMBER` are already set in the server
   `.env` (GCash, Shem Joshua M. Dumpor). No action needed; just do not commit
   them — `.env` is gitignored and must stay that way.

## Decisions still owed, raise each when it becomes relevant

- **The Flutter template route — ask before E5, not during it.** 0 of 28
  template shots exist, neither named repo has a live demo, and building them
  hits B-3. With the 13 kiosk screens that is 41 of 69 screens gated at step
  one — the largest schedule risk in the track.
- Localization ruling execution (E5.2); the `client/web` light-only statement.
- **Still hardware-blocked:** the kiosk Pi is offline — all of E4, E0.3's three
  wait measurements, and D-11's orientation question.

## Habits this project has paid for — carry them

- Check the route, the field name, and your own harness before recording a
  defect. Every failing assertion in E1 was the test, not the API — six times.
- A 400 can be validation, not the thing you are testing.
- Two tools' answers are not a diff. `findstr`'s exit code does not propagate
  through ssh → PowerShell; trusting it produced a confident, wrong conclusion.
- A test that has never been red proves nothing. Mutation-check.
- "Executed" is not "live"; "captured" is not "committed"; **"committed" is not
  "private"** — the repo is public.
- **Open the thing and look at it.**
- SSH is not blocked — run `ssh transfer@desktop-gklhcri 'hostname'` before ever
  concluding otherwise.
- When the classifier refuses, surface it once and stop. Do not reformulate.
- Default to continuing, not reporting. Findings go in `docs/PROGRESS.md`.
  Interrupt only for something the human can act on.
