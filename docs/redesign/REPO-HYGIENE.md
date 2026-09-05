# REPO-HYGIENE.md — Folder Management and Predated Documentation

The repo carries documentation that predates the 2026-09-03 architecture
change (face verification moved off the kiosk onto the phone). `Implemented.md`
§2.13 already flags two audit docs as stale on kiosk/hardware specifics. The
README frames one as historical — so this isn't a hidden trap, but a reader
can still land on a stale file and act on it.

**The fix is archival, not deletion.** These documents are the project's
engineering history and several are cited by other files. Move them where
their status is unmistakable; never delete them.

## Target structure

```
docs/
├── PROGRESS.md                    live state + screen register
├── redesign/                      this package
├── planning/                      CURRENT planning docs only
├── predated/                      NEW — everything superseded
│   ├── README.md                  NEW — index + why each file is here
│   ├── audit/
│   │   ├── documentation.md            (2026-08-05, stale on kiosk/hardware)
│   │   └── phase4-audit-report.md      (stale, same reason)
│   └── planning/
│       └── 00-start-here.md            (explicitly superseded by 04-continue-design-redo.md)
└── audit/                         CURRENT audits only → Implemented.md lives here or at root
```

## Rules

1. **Every file moved to `predated/` gets a line in `docs/predated/README.md`**
   stating: what it was, what date it reflects, what superseded it, and what
   in it is still true. A file in an archive folder with no explanation is
   just a file that's harder to find.
2. **Add a banner to the top of each moved file**, in the file itself:
   `> SUPERSEDED — reflects the system as of <date>. See <replacement>. Kiosk
   and hardware sections are known stale as of 2026-09-03.` A reader who
   arrives via search or a direct link never sees the folder name.
3. **Fix inbound references.** Grep the repo for links to each moved file and
   update the paths — a move that breaks the README's own links makes things
   worse, not better.
4. **Do not move `memory.md`.** `Implemented.md` §12 identifies it as the
   actual up-to-date running engineering log — more current than either audit
   doc. It stays where it is.
5. **`Implemented.md` is current** (2026-09-04) and is the primary source this
   redesign is built on. It does not get archived; it gets *updated* as this
   track changes things.

## What to check for, beyond the two known files

- [ ] `server/kiosk/KIOSK_CODE_SETUP.md` — five lines describing the removed
      5-camera setup were corrected in the audit session; **verify that fix
      actually landed** rather than assuming
- [ ] Any file in `docs/planning/` referencing the kiosk's face camera, the
      retired `claimItem`/`returnItem` endpoints, or a 5-camera kiosk
- [ ] Any README or doc citing the old Cloudflare tunnel hostnames — quick
      tunnels rotate on restart, so **any baked-in URL in documentation is
      wrong the moment the tunnel restarts.** Replace with a pointer to
      wherever the current URL is actually recorded, not a new hardcoded one
- [ ] The `about` page's hardware facts (camera count) — corrected once
      already; add a note in the doc index that hardware facts on the public
      site must be sourced from the kiosk config, not written from memory

## Ongoing rule for this redesign track

When this track supersedes a design decision, the old document moves to
`predated/` with its banner in the **same commit** as the new one lands.
Don't leave both current-looking in the same folder — that's exactly how the
two stale audit docs became a hazard in the first place.
