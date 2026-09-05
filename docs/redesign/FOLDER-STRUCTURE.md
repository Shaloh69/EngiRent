# FOLDER-STRUCTURE.md

```
EngiRent/
├── CLAUDE.md                     (existing)
├── memory.md                     (existing — the real current engineering log)
├── Implemented.md                (the 2026-09-04 audit this package is built on)
├── docs/
│   ├── PROGRESS.md               NEW — live state + the screen register
│   ├── REDESIGN-SIGNOFF.md       NEW — written in E5
│   ├── planning/                 (existing — CURRENT planning only)
│   ├── predated/                 NEW — superseded docs, see REPO-HYGIENE.md
│   │   ├── README.md                  index: what/when/superseded-by/still-true
│   │   ├── audit/                     documentation.md · phase4-audit-report.md
│   │   └── planning/                  00-start-here.md
│   └── redesign/                 NEW — this package
│       ├── 00-START-HERE.md
│       ├── USER-JOURNEY-SIMULATION.md
│       ├── TEMPLATE-LINKS.md
│       ├── ANIMATION-AND-LOADING-SPEC.md
│       ├── DEFECTS-AND-GAPS.md
│       ├── CAPABILITY-GAPS.md
│       ├── ENDGOAL-AND-TRACKING.md
│       ├── CLAUDE-CODE-PLAYBOOK.md
│       ├── STATE-MATRIX.md
│       ├── VISUAL-EVIDENCE.md
│       ├── API-TEST-PLAN.md
│       ├── REPO-HYGIENE.md
│       ├── ENGIRENT-CLAUDE.md
│       ├── FOLDER-STRUCTURE.md
│       └── phases/E0-discovery-and-hygiene.md … E7-website-and-signoff.md
│
├── design/                       NEW — see VISUAL-EVIDENCE.md
│   ├── templates/                COMMITTED — the reference, one per screen
│   ├── before/                   COMMITTED — captured in E0, before any change
│   ├── after/                    COMMITTED — captured at PASS
│   ├── comparisons/              COMMITTED — template|before|after triptychs
│   │   └── index.html                 review surface for E7
│   ├── baselines/                COMMITTED — Playwright snapshotDir
│   ├── screenshots/              GITIGNORED — disposable iteration captures
│   └── qa-report/                GITIGNORED — Playwright HTML reporter
│
├── server/{node_server,python_server,kiosk}/   (existing — see scope boundary)
└── client/{admin,flutter_app,web}/             (existing)
```

## Naming

`<surface>-<screen-slug>.png`, surface ∈ {`flutter`, `admin`, `kiosk`, `web`}.
Examples: `flutter-face-verify.png`, `admin-disputes.png`,
`kiosk-idle-qr.png`, `web-pricing.png`.

## Rules

- `design/templates/` and `design/baselines/` are committed — they're the
  visual contract; losing them means losing the ability to verify anything
- `design/screenshots/` and `design/qa-report/` are gitignored
- **No screenshot containing real user data gets committed.** The database is
  currently wiped to one admin, but that changes the moment anyone registers.
  Admin console captures especially — use seeded/fixture data
- Documentation lives in `docs/`. Don't create a second home for it
