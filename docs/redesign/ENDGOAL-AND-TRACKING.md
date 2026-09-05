# ENDGOAL-AND-TRACKING.md — What "Done" Means, and How to Always Know Where You Are

## Part 1 — The end goal

**EngiRent is finished, for the purposes of this track, when a student can
rent a piece of equipment from another student, collect it from a physical
locker, and return it — without ever being confused about what the system is
doing, without needing to reload anything, and without an admin having to
intervene in anything the system could have handled itself.**

That's the sentence. Everything below is what it decomposes into.

### The five conditions of done

**1. Nothing is broken that a user would notice.**
All six defects in `DEFECTS-AND-GAPS.md` fixed, each covered by a test, and
every instance the D-6 pattern sweeps turned up fixed too — not just the five
that were reported.

**2. Nothing requires a reload.**
Chat, rental status, deposit/return outcomes, verification approval, admin
queues — all live. Connection state visible; refetch on reconnect. The
Socket.io infrastructure already exists and works for the kiosk; when this is
done it works for everything.

**3. Every screen on every surface has a named template and a screenshot pair
on disk.** Four surfaces, one rule, no exceptions. `FAILED` screens either
fixed or explicitly named in the sign-off with a reason — never quietly
omitted.

**4b. The item-comparison pipeline is measured before it is changed.**
A-3's confidence distribution exists, and any pipeline change names the number
it moved. A change that cannot be shown to have improved a measured outcome
does not count as done.

**4. Every endpoint is tested, and the trust boundary has been attacked.**
Full coverage per `API-TEST-PLAN.md`. The kiosk session store — which is where
"a person is physically standing here" becomes true — has been tested by
trying to break it, not just by using it correctly.

**5. The system tells the truth about itself.**
Verification status is current and live. PENDING reads as pending, not
failure. Mock payments are unmistakably mock. Predated docs are archived and
bannered. Hardware facts on the public site are sourced. `Implemented.md`
reflects reality at the end, not at the start.

### What is explicitly NOT part of done

The face-verification trust architecture, GPIO timings, schema, auth, payments
logic — and the **85/60/retry-10 thresholds**, which stay put unless A-3's
measured distribution says otherwise.

**Changed 2026-09-06:** the **item-comparison pipeline is now IN scope** (see
`ENGIRENT-CLAUDE.md` §1 and `ITEM-VERIFICATION-PIPELINE-GAPS.md`). What feeds
the score and how it is composed is in; where the thresholds sit is not. A-3's
ML reporting is a **prerequisite** for any pipeline change — measure first. **Most of the API and the entire
hardware path are proven working** — E1 makes that automated, it doesn't
question it.

### The one-sentence test for any proposed work

*"Does this make the rent → collect → return loop clearer, faster, or less
dependent on a human?"* If no, it goes in the backlog, not this track.

---

## Part 2 — Always knowing where you are

### The phase map — 8 phases

| # | Phase | One-line goal | Gate to leave it |
|---|---|---|---|
| **E0** | Discovery & hygiene | Know what's actually there | 3 registers built, defects reproduced, waits measured, gate proven |
| **E1** | API + socket suite | Make "it works" repeatable | Every endpoint covered; socket audit done |
| **E2** | Defects + real-time | Fix what's broken | Every defect fixed **and tested**; verified on two devices |
| **E3** | Design foundation | One system, four stacks | Tokens generate everywhere; contrast verified |
| **E4** | Kiosk handoff | The signature moment | Every beat on both screens, on real hardware, two lockers |
| **E5** | Flutter app | Every screen | All screens PASS or explicitly deferred |
| **E6** | Admin + kiosk UI **+ item-verification pipeline** | Every page; pipeline measured then improved | Settle action works; role gating in place; **E6.5 pipeline work done with measured evidence or explicitly deferred** |
| **E7** | Website + sign-off | Close it out | 3 registers reviewed; sign-off committed |

### The status line — required at the start of every response

Every Claude Code response in this track opens with one line:

```
[E2 · Defect fixes · 4/7 sections · defects 3/6 fixed · screens 12/58 PASS]
```

Format: `[phase · name · sections done/total · defect progress · screen register]`

The screen total is **whatever E0.6's enumeration actually produces** — the
number in the example above is illustrative, not a target. Until E0.6 runs,
write `?` for the total rather than guessing.

**Why:** an eight-phase track across four surfaces loses its thread otherwise,
and the human shouldn't have to ask "where are we." If the numbers can't be
filled in, `docs/PROGRESS.md` is stale — fix that before continuing.

### The three registers — the actual source of truth

Live in `docs/PROGRESS.md`, built in E0.6, updated continuously:

1. **Screen register** — every screen, all four surfaces: template row?
   template shot? impl shot? PASS/FAILED? how many passes has it taken?
2. **Defect register** — D-1…D-6 plus every instance the sweeps found:
   analysis confirmed? fixed? test covering it?
3. **Endpoint register** — every endpoint: five minimum cases, pass/fail

**A phase cannot be marked complete while its register rows are blank.** The
registers are the deliverable; the code is what makes them true.

### When to surface something, and when to just keep going

**Default: keep working.** `docs/PROGRESS.md` is the running report — findings,
fixes, corrections and register deltas go *there*, continuously. The human does
not need a written summary per section, per screen, or per capture. A long
narration of routine progress is noise that hides the one line that mattered.

**Surface immediately — these are worth interrupting for:**

1. **Blocked.** Something cannot proceed without a credential, hardware, a
   permission, a file, or a decision only the human can make. Say what is
   blocked, what would unblock it, and what is still moving meanwhile.
2. **A ruling that changes hours of work** — anything on the open-decisions
   list, or a fork where guessing wrong wastes a phase.
3. **A security finding.** Fixed immediately *and* reported (§5 rule 3).
   Never batched into a later summary.
4. **Context is filling, or a `/clear` is due** (`CLAUDE-CODE-PLAYBOOK.md`
   §2b). Say so plainly — the human cannot see context fill from their side.
5. **About to do something hard to reverse on a live system** — a deploy, a
   restart, a destructive DB or file operation. Confirm unless already
   authorized for that specific class of action.
6. **A previous report was wrong.** Correct it as soon as it is known. A
   retracted finding is cheap; a wrong one left standing is not.
7. **The docs conflict with the repo in a way that changes the plan** — not
   every small doc error, which just gets fixed and logged.
8. **Phase boundary** — the end-of-phase checkpoint below.

**Do not interrupt for:** a section finishing, a screen captured, a defect
found and recorded, a defect *fixed*, a doc corrected, a sweep completed with
nothing to report, a tool or environment workaround, or any progress already
visible in the registers.

**The bar is "does this threaten the implementation as a whole?"** — not "is
this interesting", and not "was this hard to find". A defect that is found,
fixed, tested and recorded is **finished work**, and finished work goes in the
register silently. Raise it only if it changes the plan, blocks something, or
the human has to decide something. Most findings do not.

**The status line still opens every response** — it is one line, it is the
"where are we" mechanism, and it is not a report. Keeping it is not a reason to
add prose around it.

**A judgment call:** if unsure whether something clears the bar, ask whether
the human could *act* on it. If there is nothing for them to decide or unblock,
it belongs in `docs/PROGRESS.md`, not in the conversation.

### End-of-phase checkpoint

Before moving to phase N+1, report to the human:
- The status line
- What was actually run vs. inspected
- Register deltas (what moved to PASS, what's still FAILED and why)
- Open decisions still needing a ruling
- What phase N+1 will do first

Then `/clear`, and start the next session by reading `CLAUDE.md` →
`ENGIRENT-CLAUDE.md` → `docs/PROGRESS.md`.

### The end-of-session question

> **"Which parts of this did you actually run, and what are you unsure about?"**

Answered **whenever the work stops** — a phase boundary, a blocker, a `/clear`,
or handing back to the human — not after every chunk of progress.

This project has been bitten repeatedly by code that compiled, passed tests,
and was broken on screen. **It happened twice in one day on defect D-1 alone:**
the documented analysis named the wrong cause, and the first fix passed six
green unit tests while the bug was still visible on the Profile tab. Only
opening the app caught it. The honest answer to this question is usually the
session's most valuable output — which is exactly why it should not be diluted
into a per-section ritual.
