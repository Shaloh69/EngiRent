# Must-Have App Features — a reusable checklist

**This document is written to be copied into any project, not just this one.** Sections 1–8 are generic — no project-specific names or branding. An "Applied to \<this project\>" appendix goes at the bottom of the copy, listing what's actually done versus what's a real gap, so the checklist stays honest instead of becoming a list of aspirations. Delete and rewrite the appendix per project; keep sections 1–8 as-is.

Sourced from two places: industry checklists for mobile/web app production-readiness (cited inline), and — more valuable, because it's proven rather than theoretical — real incidents found and fixed during actual development, where the generic advice ("add rate limiting", "add crash reporting") turned out to have a specific, non-obvious failure mode underneath it. Each item below states the requirement, then the concrete failure mode that makes it non-negotiable, not just nice-to-have.

Sources: [Fliplet — 16 features of a successful app](https://fliplet.com/blog/16-successful-mobile-app-features/), [Mobile App Security Checklist 2026](https://medium.com/@ampldm2025/mobile-app-security-checklist-every-team-should-follow-in-2026-9faf3aa61ac0), [Mobile App Launch Checklist — LaunchList](https://getlaunchlist.com/checklists/app-launch), [Node.js Production Checklist](https://gist.github.com/philipz/4b9418dc7087d751d669c3a689c5bc80), [API Rate Limiting in Production](https://apistatuscheck.com/blog/api-rate-limiting-429-errors-production).

---

## 1. Core UX baseline

- **Onboarding is skippable and never re-blocks a returning user.** A first-run tour that reappears every session, or that can't be dismissed, trains users to distrust the app before they've used it once.
- **Search, filter, and sort exist on every list a user has to scan more than a screenful of.** This is table stakes, not a feature — its absence is usually the first thing a real user complains about.
- **Offline is a real state, not a dead end.** Cache the last good read, queue writes made while offline, retry automatically when connectivity returns, and show the user which state they're in (stale-but-visible data beats a blank screen or a silent failure).
- **A real feedback/bug-report loop, with an admin-facing queue and a notification back to the reporter when it's resolved.** A report that vanishes into a database nobody reads is a one-way write, not a channel — it trains users to stop reporting things.
- **Localisation, if your users need it, must not assume the platform's own framework translations cover every language you claim to support.** Concrete failure mode: Flutter's `flutter_localizations` ships real translations for far fewer languages than an app's own generated strings can cover — setting the app locale to one the *framework* doesn't support (while your own strings do) throws deep inside the framework's own localization resolution, with no visible error in a release build. If you support a language the platform doesn't, you need an explicit fallback delegate for that language's framework chrome, not just your own app strings.

## 2. Auth & account trust

- **Session-expiry has a designed path, not a silent hang.** When a token refresh fails, the app must clear local auth state and route to sign-in — deliberately, once, with a guard against firing twice on a burst of concurrent 401s. Silently retrying forever or leaving the user on a broken authenticated screen is a real, common gap.
- **If your app has any concept of "verified" or "approved," it must actually gate the specific actions it exists to protect.** Building a whole review pipeline (submission, admin queue, decision, notification) and then never checking the resulting flag anywhere in the code that creates the trust-sensitive resource is a common and easy-to-miss gap — grep every write-path controller for the flag, not just the profile display code.
- **Every state a user's trust/verification status can be in needs an actionable UI, not just a label.** If "not yet submitted," "under review," and "rejected" are all real possible states, all three need a real path forward in the UI — a control that's only wired up for one of the three (usually "rejected," since that's the one that feels most urgent to fix) silently strands everyone in the other states, often invisibly, since the label still *looks* correct.
- **Rate limiting on public and costly endpoints (login, registration, password reset, anything that sends an email or costs money), keyed correctly.** Concrete failure mode: behind a reverse proxy, load balancer, or tunnel, `req.ip` resolves to the *proxy's* address for every request — meaning every real user collapses into one shared rate-limit bucket. Automated testing that also hits the app directly (bypassing the proxy) shares that exact same bucket, and can lock out real users without either party doing anything obviously wrong. The fix is reading the real origin IP header (`X-Forwarded-For`, `CF-Connecting-IP`, etc.) with the proxy correctly trusted, not `req.ip` alone.

## 3. Observability

- **Crash reporting wraps the whole app entry point, not just the widget tree.** A crash during startup, before the UI framework has even mounted, is exactly the kind that's invisible if the reporting hook is only attached inside the first screen.
- **Structured logs, not scattered print statements** — and a plan for what happens when no error-reporting DSN/key is configured (degrade to local logging, never crash the app because observability itself isn't set up yet).
- **A health-check endpoint for every backing service** (database, cache, any third-party API the app depends on to function) — not just "the process is running."
- **An admin-facing audit log for privileged actions**: who did what, to what, when, and why. "Who unlisted this item" or "who approved this account" needs to be answerable from a screen, not from `grep`-ing a log file on a server only one person can reach.

## 4. Release & update management

- **Versioned releases with a real, dated changelog** — sourced from what actually shipped, written after the fact from real commits/tickets, never invented to make a release look more substantial than it was.
- **A minimum-supported-version gate for genuinely broken old builds** — a hard, non-dismissible block, reserved for versions that can no longer safely talk to the current API contract.
- **A separate, "you're outdated" notice for anything behind the latest version**, distinct from the hard minimum-version floor. Real content, not a bare version number: what's actually new, and — if your project tracks bug reports — credit to whoever found the bug that's fixed in this release. Decide explicitly whether this is dismissible (resurfaces next launch) or a hard block, and treat that as a real product decision, not a default to guess at.
- **The update notice's call-to-action must point at your actual, working distribution path.** Concrete failure mode: a placeholder link to an app-store listing that was never published, sitting unnoticed because the gate that contains it had never actually fired against a real device before someone checked.
- **A rollback plan.** If a release ships a real regression, there needs to be a known way back — pointing the app at a previous known-good API version, or a kill switch for the specific broken feature — that doesn't require a new app-store review cycle to execute.

## 5. Admin / ops tooling (if the product has any staff/privileged role at all)

- **Role granularity.** Not every staff member needs every permission — separate "can clear the routine review queue" from "can touch money, user accounts, or system configuration."
- **Bulk actions** on anything an admin might realistically need to moderate at scale — one-row-at-a-time moderation doesn't survive a real spam wave or a real incident.
- **CSV/data export** for anything that needs to leave the screen — audits, reports, a thesis/stakeholder defense, an external compliance request.
- **Saved filters / remembered table state.** Small, and disproportionately annoying when missing — an admin re-applying the same three filters every session is a real, avoidable friction cost.
- **A remote "unstick" action for your specific physical/hardware failure mode** (a stuck locker, a hung background job, a stalled webhook retry). This should work at the data layer even when the physical/remote system itself is unreachable — the whole point is unblocking a user when the hardware *isn't* cooperating.

## 6. Testing & verification discipline

This is process, not a feature — but it's the thing that catches everything above before a user does.

- **Verify against the real deployed instance**, not a local dev server, not a mock. A payload that's correct in a unit test can still be wired to nothing in the real, deployed app.
- **Verify in every visual mode the design claims to support** (every color scheme, every supported viewport/text-scale) — against the actual deployed build, not a screenshot taken once in whichever mode happened to be active.
- **Exercise the failure path, not just the happy path.** Cancel the operation, disconnect the network mid-request, submit the invalid input — a feature that's only ever been driven down its success path has an unknown number of untested failure modes.
- **A payload containing a URL, an ID, or a success flag is not evidence a human can actually see or use the result.** Assert on the real rendered thing — an image's actual pixel dimensions, a UI element genuinely present on screen, a byte-for-byte checksum match on a downloaded file — not just that the API response has the right shape.

## 7. Accessibility & compliance

- **Screen-reader labels on every icon-only control.** Cheap per-screen, expensive to retrofit once every screen exists — do this early, not as a final pass.
- **Text-scale tolerance.** Real device accessibility settings go well past 2x the base font size (further on some manufacturer skins) — fixed-height rows, sticky bars, and card headers are exactly the elements that silently clip first.
- **A real, working privacy policy and data-deletion path if the app stores anything personal or biometric** — not a placeholder page, and not a "contact support" dead end for a right the user is legally entitled to exercise themselves.
- **If the design system claims both light and dark mode, both must be verified against the real deployed build.** A "verified" screenshot taken in light mode, on a local dev server, with a database that happens to have seed data, is not evidence dark mode — or an empty database, or the deployed instance — actually works. All three conditions have to be checked independently; each has hidden a real bug in practice.

## 8. Trust & safety (domain-dependent, but check whether it applies)

- **State every "cancel," "refund," or "dispute" policy plainly, before the moment it matters** — not discoverable only by triggering it and seeing what happens.
- **If your system holds a security deposit, a hold, or any liability cap, enforce it as a hard ceiling in code**, not just as a number displayed in the UI. A number that's merely displayed can drift out of sync with what the code will actually collect.
- **A report/flag path for user-generated content or listings**, independent of whether the reporter has any other relationship to the thing being reported (you shouldn't need to have rented an item to report it as unsafe).

---

## Applied to EngiRent (2026-08-10)

Cross-checked against this codebase's actual state, not assumed. "Done" means live-verified against the deployed instance this session, not just present in code.

| Section | Status |
|---|---|
| §1 Core UX baseline | **Done.** Search/filter across all major lists, real offline queueing (Stage 4), real feedback loop with admin triage (Stage 3, this session), Bisaya/Filipino localisation (Stage 9 — the framework-locale gap in §1's localisation item is this app's own real incident, found and fixed 2026-08-10). |
| §2 Auth & account trust | **Done, after two real gaps closed this session.** Session-expiry handling shipped in Stage 9. The verification-gates-nothing gap (§2, bullet 2) and the dead-Identity-tile gap (§2, bullet 3) were both real, live bugs reported by real users and fixed 2026-08-10 — see `memory.md`. Rate-limiting's proxy-IP gap (§2, bullet 4) was a real live incident earlier this session, fixed the same day it was reported. |
| §3 Observability | **Done.** Crash reporting wraps `main()` (Stage 1.1), structured logging throughout, `/health` plus per-service checks, real audit log (Stage 9). |
| §4 Release & update management | **Done, built 2026-08-10.** Versioned `AppRelease` rows, real dated `/changelog`, a two-tier gate (hard minimum-version floor from Stage 9, plus the stricter any-outdated-version hard block from this entry), the dead Play-Store-link gap closed (now points at the real `/downloading` flow). Rollback plan (§4, last bullet): **not built** — no API-version pinning or feature kill-switch exists yet; noted here rather than left silent. |
| §5 Admin / ops tooling | **Done.** REVIEWER role granularity, bulk moderation, CSV export, saved filters, kiosk locker remote release — all Stage 9. |
| §6 Testing & verification discipline | **This is the standing rule for every stage this session** — real deployed instance, both color schemes, failure paths, checksum-verified downloads rather than trusting a success flag. Not a checklist item to "complete"; a discipline maintained throughout. |
| §7 Accessibility & compliance | **Mostly done.** Semantics pass across icon-only controls and 1.3×/360px verification (Stage 9). Privacy/data-deletion path exists (`DELETE /auth/account`, real biometric erasure). **Gap, not yet closed**: no standalone published privacy-policy document/page — the in-app consent copy states what's collected, but there's no dedicated policy page a student could be pointed to independently. |
| §8 Trust & safety | **Done.** Cancellation policy and damage-protection cap stated before payment and enforced as a hard ceiling in `settleDispute` (Stage 8), report-a-listing path independent of rental history (Stage 8). |

**Two honest, currently-open gaps, not silently dropped**: no rollback/kill-switch mechanism for a bad release (§4), and no standalone privacy-policy page (§7). Both are real, scoped, and small enough to pick up in a future session — recorded here rather than left implicit.
