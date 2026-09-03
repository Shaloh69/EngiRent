// Real, dated entries condensed from the project's own engineering log
// (repo root memory.md). No invented dates, no invented features — this is
// a public-facing rewrite of what memory.md already records in full detail,
// same rule the /blog page's project journal follows (§3.5 of the design
// mandate bans fabricated changelog/blog content).

export type ChangelogTag = "release" | "feature" | "fix" | "design" | "infra";

export interface ChangelogEntry {
  date: string; // ISO, real
  version?: string; // only set when the entry corresponds to an actual app version bump
  tag: ChangelogTag;
  title: string;
  bullets: string[];
}

export const changelog: ChangelogEntry[] = [
  {
    date: "2026-09-03",
    version: "1.8.0",
    tag: "feature",
    title: "Identity verification moved from the kiosk to your phone",
    bullets: [
      "Claiming, depositing, or returning an item no longer needs a kiosk camera pointed at your face — after scanning the kiosk's QR code, a verification page opens on your own phone instead",
      "One less camera watching a public corridor, and your phone's camera does a better job in real lighting than a fixed one ever could",
      "The kiosk now just waits and tells you to check your phone, with a real cancel — it never stalls on a step it can no longer perform",
      "Verification still runs against your enrolled ID photo, and the phone never decides the result itself — only the server does, exactly as before",
    ],
  },
  {
    date: "2026-09-03",
    tag: "fix",
    title: "The kiosk, made genuinely usable end to end",
    bullets: [
      "Scanning the kiosk's QR code now actually starts a rental — it used to mark the session connected and then sit there, because the screen the code is displayed on was not one the app's scan was allowed to advance from",
      "The touchscreen no longer comes up blank after a power cut: the installer never built the kiosk interface, so there was nothing for the browser to load",
      "Fixed the kiosk browser both failing to reopen after a crash and, in the opposite case, stacking a new fullscreen window every ten seconds",
      "Each locker camera is now bound to a stable hardware address, so the photos taken for item verification are of the locker they claim to be",
      "Locker open/close commands reached the hardware again — the console was addressing a kiosk ID that did not match the one the hardware registers under, and reported success either way",
    ],
  },
  {
    date: "2026-09-03",
    tag: "infra",
    title: "Admin tooling and deployment hardening",
    bullets: [
      "Admins can approve or reject a payment directly while card payments are still being finalised, so a rental is never stuck waiting on a payment provider",
      "The console's kiosk page was rebuilt on the same design system as the rest of the console instead of its own one-off styling",
      "ID verification no longer times out when a reviewer approves during heavy load",
      "Restored the full deployment after a site-wide brownout, and wrote down the recovery steps so the next outage is a checklist rather than a diagnosis",
    ],
  },
  {
    date: "2026-08-10",
    version: "1.7.0",
    tag: "fix",
    title: "A crash fix, a real safety gap closed, and an update screen that credits who found them",
    bullets: [
      "Fixed a crash that turned the whole app white when switching the language to Bisaya",
      "Listing an item or starting a rental now requires a verified student ID — a real reported safety gap",
      "The Identity tile in Profile is tappable whenever verification isn't done, not just after a rejection",
      "A real \"update required\" screen for outdated installs — real release notes, and credit to the students who reported the bugs it fixes",
    ],
  },
  {
    date: "2026-08-10",
    version: "1.6.0",
    tag: "release",
    title: "Enterprise hygiene: sixteen features across the app and console",
    bullets: [
      "A Reviewer staff role can clear ID-verification and listing-moderation queues without touching payouts, refunds, or other accounts",
      "Every admin action — who did what, to what, and why — is now recorded to a real, queryable audit log",
      "Bulk listing moderation and CSV export for users, rentals, and transactions in the admin console",
      "Renters can extend or shorten an active rental instead of only paying a late fee after the fact",
      "New account activity, transaction history, and notification preference screens",
      "Remote locker release for a stuck kiosk door, straight from the admin console",
      "A screen-reader pass across icon-only controls, plus Bisaya and Tagalog language support",
    ],
  },
  {
    date: "2026-08-10",
    tag: "feature",
    title: "Real availability, listing video, and trust & safety",
    bullets: [
      "Item availability now checks actual booking date ranges instead of a single on/off flag",
      "Owners can attach a short video to a listing, alongside photos",
      "Owner completion rate and renter on-time rate are shown where they matter; a listing can be reported directly",
      "The cancellation policy and the deposit's damage-protection cap are stated before payment, not discovered after",
    ],
  },
  {
    date: "2026-08-10",
    tag: "feature",
    title: "Works offline, and lets people talk it out",
    bullets: [
      "The app caches the last good data and queues actions taken while offline instead of failing outright",
      "In-app messaging scoped to a rental, so a dispute has a real transcript instead of a phone number exchanged in person",
    ],
  },
  {
    date: "2026-08-10",
    tag: "feature",
    title: "Crash reporting, My Listings, and a real feedback loop",
    bullets: [
      "Crash reporting wired through the whole app startup, not just the visible screens",
      "Owners can finally see, edit, and unlist their own listings after publishing them",
      "A real bug/feedback pipeline, with an admin triage queue and a resolution notice back to the reporter",
      "Item moderation and review removal, with a reasoned, attributable trail",
    ],
  },
  {
    date: "2026-08-09",
    tag: "feature",
    title: "Account verification, for real this time",
    bullets: [
      "A real review queue for student ID verification, with the actual evidence visible to the reviewer",
      "A rejection now says why, and re-submitting clears the old reason instead of showing both at once",
      "Fixed a cross-origin bug that was silently blocking verification photos from ever rendering",
    ],
  },
  {
    date: "2026-08-07",
    tag: "design",
    title: "A new design system: EngiRent Vault",
    bullets: [
      "One palette, one type stack, and animated backgrounds across the phone app, admin console, kiosk, and this site",
      "The admin console rebuilt from scratch on Mantine; this site rebuilt on Velora UI",
      "Full light and dark mode everywhere except the kiosk touchscreen",
    ],
  },
  {
    date: "2026-08-06",
    tag: "design",
    title: "Kiosk migrates to React, this site drops its starter kit",
    bullets: [
      "The kiosk touchscreen UI rebuilt on React and Vite, including a dedicated offline-fallback screen",
      "This site fully migrated off its original UI kit, down to zero leftover scaffold files",
    ],
  },
  {
    date: "2026-08-06",
    tag: "infra",
    title: "Real money movement, and biometric data actually encrypted",
    bullets: [
      "Owner payouts and deposit refunds run through real PayMongo transfer and refund calls, not a ledger entry",
      "Face templates encrypted at rest instead of stored in the clear",
      "Closed off client-controlled payment amounts — the server decides what a rental costs, not the app",
      "Photo and file storage moved off a third-party bucket to the project's own server",
    ],
  },
  {
    date: "2026-08-05",
    tag: "infra",
    title: "Where this started: a full independent audit",
    bullets: [
      "A ground-up audit of the whole codebase against its own documentation, correcting claims that didn't hold up",
      "The staged revamp plan that every entry above worked through, written from that audit",
    ],
  },
];

export const changelogTagLabel: Record<ChangelogTag, string> = {
  release: "Release",
  feature: "Feature",
  fix: "Fix",
  design: "Design",
  infra: "Infrastructure",
};
