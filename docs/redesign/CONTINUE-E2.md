# CONTINUE-E2.md — paste into a fresh Claude Code session

> Supersedes `KICKOFF_PROMPT.md`, which starts the track from E0. E0 and E1 are
> done. Written 2026-09-06 at the E1/E2 boundary.

---

**You are resuming the EngiRent redesign track at E2. E0 and E1 are complete.**

**First: `git branch --show-current` must say `e0-e1-audit-tests-and-evidence`.**
All E0/E1 work lives there in 7 commits — the BEFORE images, the whole test
suite, and all three registers. **`main` has none of it.** If you are on `main`,
stop and tell me before doing anything else.

Read, in this order, and **only** these — re-reading the whole redesign package
is itself the context mistake the playbook warns about:

1. `CLAUDE.md`
2. `docs/redesign/ENGIRENT-CLAUDE.md`
3. `docs/PROGRESS.md` — in full. It is the source of truth and it is current.
4. `docs/redesign/phases/E2-defect-fixes-and-realtime.md`

Then resume from PROGRESS.md's **"Next concrete step — RESUME HERE"**.

Open every response with the status line from PROGRESS.md, currently:

```
[E1 · COMPLETE (named gaps) · endpoints 73/93 · 14 suites, 405 assertions (2 RED = D-32) · defects 7/32 fixed · screens 0/69 PASS]
```

Update it as E2 progresses. If you cannot fill the numbers in, PROGRESS.md is
stale — fix that first.

## Where the track actually stands

Two of eight phases done, and they were the two cheapest against the real
deliverable. **6 phases left: E2 → E7.** The foundation is genuinely solid —
the API is provably tested rather than believed-tested, and 26 defects exist
that nobody knew about — but **0 of 69 screens have passed**, there are 0 AFTER
images and 0 triptychs, and the defect register grew from 6 to 32.

## Start here — E2's payments work

Your first task is PAYMENTS RULING items 1-3 in PROGRESS.md. It is the critical
path, and unlike everything else in E2 it is blocked on nothing:

1. `POST /payments` stops building a PayMongo checkout URL — create the PENDING
   transaction, return an awaiting-confirmation state.
2. **D-23 in the same change.** `rental_detail_screen.dart:130-132` bare-`return`s
   on a null `paymentUrl`, which under manual payments is now *always* null. Left
   alone, Pay Now does nothing for every user — it is a total blocker, not a defect.
3. Add the payment-decision socket event. `adminDecidePayment` writes a
   Notification row and emits nothing, so an approval never reaches the phone.

Then the payment-instructions screen — which needs a `TEMPLATE-LINKS.md` row
first (the gate applies) and a **schema addition** for the out-of-band payment
reference. Flag that one rather than doing it unilaterally; `ENGIRENT-CLAUDE.md`
§1 puts the Prisma schema out of scope.

## Decisions I still owe you — ask when each becomes relevant, not upfront

- **The Flutter template route. Ask this before E5, not during it.** 0 of 28
  template shots exist, neither named repo has a live demo, and building them
  hits B-3 (the VS Code Dart language server holds a lock on the Flutter web SDK
  cache). With the 13 kiosk screens, that is **41 of 69 screens gated at step
  one** — the largest schedule risk in the track.
- **D-32's deploy.** Half-landed and safe: `errors.ts` has `GoneError` on the
  server, `kioskController.ts` does not, Node was never restarted. Needs either a
  Bash permission rule for writes under `D:\ENG\EngiRent\server\node_server\src`,
  or two lines by hand. The two RED assertions in `e2e-coverage-sweep` are that
  test doing its job; do not "fix" them by weakening the assertion.
- Localization ruling execution (E5.2); the `client/web` light-only statement.

## Still blocked on hardware

The kiosk Pi is offline — that is **all of E4**, E0.3's three wait measurements
that E4's animation spec depends on, and D-11's orientation question (if the
display is not rotated at OS level, the live kiosk has been showing users the
landscape safety-net layout).

## Habits this project has paid for — carry them

- **Check the route, the field name, and your own harness before recording a
  defect.** Every failing assertion in E1 was the test, not the API — six times.
  The register field is `phoneNumber` not `phone`; auth returns
  `data.tokens.accessToken` not `data.accessToken`; `/kiosk/return` validates
  `lockerId` and `images` too.
- **A 400 can be validation, not the thing you are testing.** These probes send
  minimal bodies, so a 4xx does not prove the guard ran.
- **Two tools' answers are not a diff.** `findstr`'s exit code does not
  propagate through ssh→PowerShell; trusting it produced a confident, wrong,
  nearly-reported conclusion this session. Read output, not status.
- **A test that has never been red proves nothing.** Mutation-check: break the
  source, watch it fail, restore.
- **"Executed" ≠ "live", and "captured" ≠ "committed."** The server is a
  diverged checkout deployed by file copy. Say which one you mean.
- **Open the thing and look at it.** Typecheck-clean and tests-green has been
  insufficient here repeatedly.
- **SSH is not blocked** — `ssh transfer@desktop-gklhcri 'hostname'` before ever
  concluding otherwise. `ACCESS-AND-WORKAROUNDS.md` §1a-1b has the shapes that
  do get refused, and the `node --% -e` trick that makes remote work possible.

**Default to continuing, not reporting.** Put findings in `docs/PROGRESS.md` and
keep working. Interrupt only for something I can act on — blocked, a ruling, a
security finding, context filling, an irreversible action on a live system, a
correction to something already reported, or a phase boundary.
