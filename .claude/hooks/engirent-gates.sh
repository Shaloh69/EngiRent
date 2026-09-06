#!/usr/bin/env bash
# EngiRent redesign track — mechanical restatement of the context-degradation
# gates, injected on every user turn.
#
# Why this exists as a hook rather than as documentation: the gates WERE
# documentation (CLAUDE-CODE-PLAYBOOK.md 2b) and degradation still happened
# twice, both times noticed by the human rather than self-reported. A rule the
# model has to remember to re-read is a rule that stops binding exactly when
# context fills, which is precisely when it is needed. The full statement and
# the incident log live in CLAUDE-CODE-PLAYBOOK.md 2c-2d and in PROGRESS.md.
#
# Keep this SHORT. It is re-injected every turn and pays a token cost each time.

printf '%s' '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"EngiRent track gates (CLAUDE-CODE-PLAYBOOK.md 2d). Context degradation has happened TWICE here and both times the human detected it, not the model.\nG4 STATUS LINE: open EVERY response with the PROGRESS.md status line. There is no report-only carve-out; working and one-line replies need it too.\nG1 VERIFICATION DEBT: at most ONE built-but-not-yet-seen-on-screen change at a time. Verification blocked by a permission refusal or offline hardware STILL COUNTS as unverified, and that is when G1 binds hardest. Stop and surface rather than stacking a second.\nG2 PHASE START: no implementation edit until PROGRESS.md holds a dated, repo-derived section-by-section table for the current phase. A start-with-X instruction reorders work, it does not waive this.\nG3: never assert a phase or defect is done from memory; re-derive and cite it in the same response.\nG5: run the six-symptom check at each phase-section boundary and log it in PROGRESS.md, including a result of no symptoms.\nG6: secret sweep before the first commit of a session.\nThe repo wins over the docs. A green test is not a fix."}}'
