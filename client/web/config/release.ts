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
  version: "1.14.5",
  buildNumber: 39,
  fileName: "Engirent_Prerelease39.eda64bd1739319a926f51503eb0bf6a6.apk",
  released: "2026-10-13",
  sizeMb: 88.1,
  minAndroid: "8.0 (Oreo)",
  highlights: [
    "Report a problem the locker camera cannot see: a broken item you just picked up, or damage found after a return, with a statement, photos and a short video",
    "Follow each case on the rental: the other student's answer, the admin's decision in plain words, and any refund or amount owed",
    "Tapping a notification now opens its rental, and return dates and \"due\" labels match your calendar",
  ],
};

/** Public path Next.js serves the APK from. */
export const androidDownloadPath = `/downloads/${androidRelease.fileName}`;
