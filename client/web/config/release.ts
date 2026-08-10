// Single source of truth for the currently-published Android build.
//
// Update this object when a new APK is published, and every surface that
// mentions the release (the /download page, the navbar CTA, the home hero)
// follows automatically — the alternative is a version string copy-pasted
// into three files that silently drift apart.
//
// The APK itself is NOT committed: `.gitignore` excludes `*.apk` repo-wide,
// and a ~75MB binary per release would bloat the history quickly. It is
// copied into `client/web/public/downloads/` on the host at deploy time, and
// Next.js serves it as a static file from there.

export interface AndroidRelease {
  /** Marketing version, matches pubspec.yaml's `version:` field. */
  version: string;
  /** Android versionCode — the build number after the `+` in pubspec. */
  buildNumber: number;
  /** Filename under /public/downloads, per the project's naming convention. */
  fileName: string;
  /** ISO date the build was produced. */
  released: string;
  /** Approximate size, shown so people on mobile data know what they're in for. */
  sizeMb: number;
  /** Minimum Android version the build supports. */
  minAndroid: string;
  /** Short, human-readable list of what changed in this build. */
  highlights: string[];
}

export const androidRelease: AndroidRelease = {
  version: "1.6.0",
  buildNumber: 16,
  fileName: "Engirent_Prerelease16.eda64bd1739319a926f51503eb0bf6a6.apk",
  released: "2026-08-10",
  sizeMb: 83,
  minAndroid: "8.0 (Oreo)",
  highlights: [
    "Renters can extend or shorten an active rental instead of only paying a late fee afterward",
    "Item availability now checks real booking date ranges, not a single on/off flag",
    "Owners can attach a short video to a listing",
    "Owner completion rate and renter on-time rate shown where they matter, plus a report-a-listing path",
    "The cancellation policy and the deposit's damage-protection cap are stated before payment",
    "Works offline — the app caches the last good data and queues actions until you're back online",
    "In-app messaging scoped to a rental, for real dispute transcripts",
    "New account activity, transaction history, and notification preference screens",
    "Bisaya and Tagalog language support, and a screen-reader pass across icon-only controls",
  ],
};

/** Public path Next.js serves the APK from. */
export const androidDownloadPath = `/downloads/${androidRelease.fileName}`;
