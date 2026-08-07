# EngiRent Hub — Continuation Prompt (post Phases 0-2, mid design redo)

Paste this into Claude Code to pick up from the actual current state — this supersedes `EngiRent_00_START_HERE.md`, which describes the original starting point and is now historical.

---

**Status, for context:** Phases 0-2 are code-complete (security/financial fixes, real PayMongo payout/deposit-refund logic, feature completion). Hosting migration (Phase 0.5) is largely done — Supabase dropped for local storage, MySQL self-hosted, Tailscale/SSH working to both `desktop-gklhcri` and the Kiosk Pi. The duplicate Flutter admin console was retired; `client/admin` is the one going forward. The Kiosk was migrated off Flask+vanilla-JS onto React/Vite. The Phone App was reported fully finished (all 16 screens). Phase 4's audit is still blocked on one item: a PayMongo sandbox key. `Start-Dev.bat` was reported broken (no terminals/servers/UI actually launching) and needs debugging, not just re-reading.

**What's changed since all of that, and why it matters now:**

1. **`EngiRent_02_DESIGN_MANDATE.md` was substantially rewritten.** Read it in full before touching any design work. Two changes affect work already done:
   - **The color palette changed entirely** — from violet/amber/coral to "EngiRent Vault" (deep teal `#0D9488` primary, gold secondary, coral tertiary). Every surface already themed under the old palette — the Kiosk and the Phone App both — needs re-theming to the new one. Audit both for lingering violet/`#7C3AED` references before doing anything else.
   - **The verification loop was hardened after a real failure.** Live screenshots of the deployed Admin Console showed a missing chart, unreadable text, and a palette that wasn't actually applied, despite `DESIGN.md` claiming it was built and verified. Read §0's account of exactly what was found. Before redoing the Admin Console, explain what the previous verification loop actually checked and why it didn't catch that — then rebuild it as a genuine delete-and-rebuild, not an edit, per the hardened loop (screenshot the real deployed instance, explicit contrast/palette/component checks).

2. **All four surfaces now have real, linked template references** — Phone App (three Figma Community kits), Admin Console (Mantine Analytics Dashboard), Kiosk (three real Dodo Pizza / self-service kiosk Figma files), and `client/web` (Velora UI, a complete real Next.js marketing template). Use these directly rather than designing from a blank page.

3. **`client/web`'s design scope is resolved — it's in scope, build it fresh from Velora UI per §3.5.** Its *hosting* location (whether it moves to the PC) is a separate, still-open question — ask me before deciding, don't bundle it with the design decision.

**Work order for this session:**
1. Fix `Start-Dev.bat` for real — debug it live, don't just re-read the script.
2. Palette audit across Kiosk and Phone App — find and fix every old-palette reference.
3. Admin Console: explain the prior verification gap, then full delete-and-rebuild per the hardened §0 loop.
4. `client/web`: build fresh from Velora UI.
5. Re-run the hardened verification loop on everything that changed — real deployed instance, explicit checks, not an impression of "looks styled."
6. Update `DESIGN.md` and `memory.md` with the full current state, including an honest account of what the palette change and the Admin Console redo actually touched.

Still just the one separate open item: I still need to get you a PayMongo sandbox key for Phase 4. Don't block the above on it.

Don't report any surface as done without the screenshots — of the real running instance — to back it up.
