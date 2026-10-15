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
  version: "1.15.1",
  buildNumber: 43,
  fileName: "Engirent_Prerelease43.eda64bd1739319a926f51503eb0bf6a6.apk",
  released: "2026-10-15",
  sizeMb: 115.7,
  minAndroid: "8.0 (Oreo)",
  highlights: [
    "A friendly guide shows what to do in the face check, and the ring around your face reacts: it pulses when ready, shivers if you are too far, and shows which way to turn",
    "Blinks and head turns are now recognised much more reliably, and it answers sooner",
    "Fewer real faces are wrongly refused as \"a photo or a screen\"",
  ],
};

/** Public path Next.js serves the APK from. */
export const androidDownloadPath = `/downloads/${androidRelease.fileName}`;
