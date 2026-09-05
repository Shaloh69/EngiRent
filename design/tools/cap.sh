#!/usr/bin/env bash
# Capture one Android screen into design/before/.
# MSYS_NO_PATHCONV=1 is required: git-bash rewrites /sdcard/... into a Windows
# path and screencap then fails with a usage error that looks like a flag problem.
ADB="C:/Users/Shaloh/AppData/Local/Android/sdk/platform-tools/adb.exe"
cap() {
  MSYS_NO_PATHCONV=1 "$ADB" shell screencap -p /sdcard/s.png
  MSYS_NO_PATHCONV=1 "$ADB" pull /sdcard/s.png "design/before/flutter-$1.png" >/dev/null 2>&1
  printf "  captured flutter-%s.png (%s bytes)\n" "$1" "$(stat -c%s "design/before/flutter-$1.png" 2>/dev/null)"
}
tap()  { MSYS_NO_PATHCONV=1 "$ADB" shell input tap "$1" "$2"; sleep 1.4; }
