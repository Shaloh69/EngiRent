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
  version: "1.7.0",
  buildNumber: 17,
  fileName: "Engirent_Prerelease17.eda64bd1739319a926f51503eb0bf6a6.apk",
  released: "2026-08-10",
  sizeMb: 83,
  minAndroid: "8.0 (Oreo)",
  highlights: [
    "Fixed a crash that turned the whole app white when switching the language to Bisaya",
    "Listing an item or starting a rental now requires a verified student ID — closing a real safety gap",
    "The Identity tile in Profile is now tappable whenever verification isn't done yet, not just after a rejection",
    "A real Update Required screen — release notes, and credit to the students who found the bugs",
  ],
};

/** Public path Next.js serves the APK from. */
export const androidDownloadPath = `/downloads/${androidRelease.fileName}`;
