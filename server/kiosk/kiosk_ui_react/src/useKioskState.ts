import { useCallback, useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import type { KioskServerState, Mode, Screen } from "./types";
import { FLOW_SCREENS } from "./types";
import type { WorkingKind } from "./components/screens/WorkingScreen";

const IDLE_MS = 30_000; // MAIN -> IDLE
const RETURN_MS = 5 * 60_000; // flow screens -> MAIN
const OFFLINE_GRACE_MS = 4_000; // avoid flicker on a brief reconnect

/**
 * Demo mode — for local design work and screenshot verification without a
 * running Flask/Socket.IO backend. `?demo=confirm` (etc.) jumps straight to
 * a screen with realistic placeholder data instead of waiting on a live
 * connection that doesn't exist in this environment.
 */
const DEMO_QS = new URLSearchParams(window.location.search);
const DEMO_SCREEN = DEMO_QS.get("demo") as Screen | null;

/**
 * Demo seeds for the "working" screen (E3.2 / spec 1.1). Without these,
 * `?demo=working` renders the indeterminate fallback only, and the
 * determinate bar -- the whole point of 1.1 -- could not be looked at
 * without a live Pi driving a real door.
 *
 *   ?demo=working&seconds=15        real 15s door (lockers 1/3/4)
 *   ?demo=working&seconds=5         locker 2, the one that differs
 *   ?demo=working                   duration unknown -> indeterminate
 *   ?demo=working&kind=capturing    indeterminate by nature
 *
 * Same precedent as the faceProgress seed below: demo-only, read once, and
 * it cannot reach a live kiosk because nothing appends a query string to
 * the autostart URL.
 */
const DEMO_WORK_SECONDS = Number(DEMO_QS.get("seconds")) || undefined;
const DEMO_WORK_KIND = (DEMO_QS.get("kind") as WorkingKind) || "door_open";

export function useKioskState() {
  const [screen, setScreen] = useState<Screen>(DEMO_SCREEN ?? "idle");
  const [offline, setOffline] = useState(!DEMO_SCREEN);
  const [mode, setMode] = useState<Mode>(DEMO_SCREEN ? "place" : null);
  const [occupancy, setOccupancy] = useState<Record<string, string> | null>(null);
  const [lockers, setLockers] = useState<Record<string, boolean>>({
    "1": false,
    "2": false,
    "3": false,
    "4": false,
  });
  const [faceProgress, setFaceProgress] = useState(
    DEMO_SCREEN === "face" ? 60 : 0,
  );
  const [faceLabel, setFaceLabel] = useState("Verifying…");
  const [faceInstr, setFaceInstr] = useState("Look directly at the camera");
  const [successSub, setSuccessSub] = useState("Locker is now open");
  const [successInstr, setSuccessInstr] = useState("Please collect your item");
  // D-87b: an optional third line, only used by the "awaiting review" outcome.
  // null on every other success so the ordinary "door is open" screen keeps its
  // two-line shape.
  const [successNote, setSuccessNote] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(5);
  const [errorMsg, setErrorMsg] = useState(
    "Please try again or contact staff for assistance.",
  );
  // A retry verdict is not a fault: the kiosk looked, was not sure, and the
  // door is open again. Rendering it as a red error taught people that a
  // normal second attempt was a breakage.
  const [errorTone, setErrorTone] = useState<"error" | "retry">("error");
  // E3.2 / spec 1.2. Was "This takes about 15 seconds." -- an invented
  // number on the one wait the spec explicitly classifies as UNKNOWN
  // duration, sitting directly above a stage list whose entire point is
  // that we cannot say how long this takes. Nothing has measured it either:
  // E0.3's three wait measurements are still outstanding (kiosk-blocked).
  // The Pi's own `message` still overrides this when it sends one.
  const [verifyingSub, setVerifyingSub] = useState(
    "Each check runs in turn. This can take a little while.",
  );
  // E3.2 / spec 1.1 -- the hardware waits. `workingDuration` is undefined
  // until the Pi sends a real one, and undefined renders indeterminate.
  const [workingKind, setWorkingKind] = useState<WorkingKind>(
    DEMO_SCREEN === "working" ? DEMO_WORK_KIND : "door_open",
  );
  const [workingLabel, setWorkingLabel] = useState(
    DEMO_SCREEN === "working"
      ? DEMO_WORK_KIND === "capturing"
        ? "Checking the bay"
        : DEMO_WORK_KIND === "dropping"
          ? "Locker 01 is placing your item"
          : "Locker 01 is opening"
      : "Working…",
  );
  const [workingSub, setWorkingSub] = useState(
    DEMO_SCREEN === "working" ? "Main door" : "",
  );
  const [workingDuration, setWorkingDuration] = useState<number | undefined>(
    DEMO_SCREEN === "working" ? DEMO_WORK_SECONDS : undefined,
  );
  const [sessionQrConnected, setSessionQrConnected] = useState(false);
  const [sessionQrUser, setSessionQrUser] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const inactTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offlineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screenRef = useRef<Screen>(screen);
  // The last Pi state sequence number this screen has ACTED on. See
  // applyServerState: a re-polled state with the same seq changes nothing.
  const lastSeqRef = useRef<number | null>(null);
  screenRef.current = screen;

  const goTo = useCallback((next: Screen) => {
    setScreen(next);
  }, []);

  // ── Inactivity timeout — mirrors the original app.js exactly, including
  // the deliberate no-timeout carve-out for "verifying" (a user told not to
  // walk away must never be silently returned to the attract screen).
  const resetInactivity = useCallback(() => {
    if (inactTimer.current) clearTimeout(inactTimer.current);
    const s = screenRef.current;
    // "working" joins "verifying" in the no-timeout carve-out. Both are
    // waits the user was explicitly told to stand through -- a 34-46s
    // actuator sequence would otherwise be interrupted by the attract
    // screen while the hardware is still moving.
    if (s === "idle" || s === "verifying" || s === "working") return;
    if (s === "main") {
      inactTimer.current = setTimeout(() => goTo("idle"), IDLE_MS);
    } else {
      inactTimer.current = setTimeout(() => {
        goTo("main");
        inactTimer.current = setTimeout(() => {
          if (screenRef.current === "main") goTo("idle");
        }, 4000);
      }, RETURN_MS);
    }
  }, [goTo]);

  useEffect(() => {
    resetInactivity();
  }, [screen, resetInactivity]);

  useEffect(() => {
    const onActivity = () => {
      if (screenRef.current !== "idle") resetInactivity();
    };
    window.addEventListener("touchstart", onActivity, { passive: true });
    window.addEventListener("mousedown", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity);
    return () => {
      window.removeEventListener("touchstart", onActivity);
      window.removeEventListener("mousedown", onActivity);
      window.removeEventListener("keydown", onActivity);
    };
  }, [resetInactivity]);

  // ── Socket.IO connection to the local Flask UI server ────────────────────
  useEffect(() => {
    if (DEMO_SCREEN) return; // no live backend in demo mode

    const socket = io({ path: "/socket.io" });
    socketRef.current = socket;

    const armOfflineScreen = () => {
      if (offlineTimer.current) clearTimeout(offlineTimer.current);
      offlineTimer.current = setTimeout(() => setOffline(true), OFFLINE_GRACE_MS);
    };

    socket.on("connect", () => {
      if (offlineTimer.current) clearTimeout(offlineTimer.current);
      setOffline(false);
    });
    socket.on("disconnect", armOfflineScreen);
    socket.on("connect_error", armOfflineScreen);

    socket.on("state_update", (s: KioskServerState) => applyServerState(s));


    socket.on(
      "kiosk_session_started",
      (data: { firstName?: string; lastName?: string }) => {
        const name = [data.firstName, data.lastName].filter(Boolean).join(" ");
        setSessionQrConnected(true);
        setSessionQrUser(name || "User");
      },
    );
    socket.on("kiosk_session_reset", () => {
      setSessionQrConnected(false);
      setSessionQrUser(null);
    });

    // Fallback poll, same 2s cadence as the original — Socket.IO events are
    // primary, this just covers a dropped event.
    const poll = setInterval(() => {
      fetch("/api/state")
        .then((r) => r.json())
        .then(applyServerState)
        .catch(() => {});
    }, 2000);

    return () => {
      socket.disconnect();
      clearInterval(poll);
      if (offlineTimer.current) clearTimeout(offlineTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyServerState(s: KioskServerState) {
    if (!s) return;
    if (s.lockers) {
      const next: Record<string, boolean> = {};
      for (const [id, doors] of Object.entries(s.lockers)) {
        next[id] = doors.main === "unlocked" || doors.bottom === "unlocked";
      }
      setLockers(next);
    }
    // D-53: relayed straight through. Deliberately NOT merged into `lockers`
    // -- door state and occupancy answer different questions and collapsing
    // them is what caused the defect.
    if (s.occupancy) setOccupancy(s.occupancy);

    const cur = screenRef.current;

    // Navigation happens only on a NEW state from the Pi. The screen polls
    // /api/state every 2s, and before this every poll re-applied the last
    // status: Cancel was undone within two seconds, and a finished deposit
    // bounced back onto the success screen forever. The passive data above
    // (door state, occupancy) is still refreshed on every poll — only the
    // decision to MOVE screens is deduplicated.
    if (typeof s.seq === "number") {
      if (s.seq === lastSeqRef.current) return;
      lastSeqRef.current = s.seq;
    }

    // The Pi saying "online" means no flow is in progress — it reverted on
    // its own after a finished outcome, or someone cancelled. If this screen
    // is still showing a flow, that flow is over: go back to ready for the
    // next person. Deliberately not applied to idle/main/info screens, where
    // someone may simply be browsing.
    if (s.status === "online") {
      if (FLOW_SCREENS.includes(cur)) goTo("main");
      return;
    }

    // "idle" = a hardware step just finished (a door closed, the actuator
    // stopped, the photos were taken). The screen cannot tell from this alone
    // whether the flow goes on — after a deposit door closes the person still
    // has to tap "Item is placed" — or is over, as after a claim. So it HOLDS.
    // The Pi resolves the ambiguity: the next step's command supersedes this,
    // or after 30s of nothing the Pi reverts to "online" and the branch above
    // returns the screen to ready. Handled explicitly so it cannot fall
    // through to the stranded-screen fallback below, which would tell someone
    // mid-deposit they were done.
    if (s.status === "idle") return;
    if (s.status === "face_scan") {
      setFaceInstr(s.message || "Look directly at the camera");
      if (cur !== "face") goTo("face");
    } else if (s.status === "verified") {
      setFaceProgress(100);
      setFaceLabel("Verified ✓");
      const lockerNum = s.active_locker
        ? `Locker ${String(s.active_locker).padStart(2, "0")}`
        : "Locker";
      setSuccessSub(`${lockerNum} is now open`);
      setSuccessInstr(
        mode === "place"
          ? "Please deposit your item and close the door"
          : "Please collect your item and close the door",
      );
      setTimeout(() => goTo("success"), 600);
    } else if (
      s.status === "door_open" ||
      s.status === "dropping" ||
      s.status === "capturing"
    ) {
      // E3.2 / spec 1.1. These three statuses have been emitted by the Pi
      // all along and consumed by nothing, so the longest waits in the
      // product ran with the main menu on screen.
      const lockerNum = s.active_locker
        ? `Locker ${String(s.active_locker).padStart(2, "0")}`
        : "The locker";
      setWorkingKind(s.status as WorkingKind);
      setWorkingLabel(
        s.status === "door_open"
          ? `${lockerNum} is opening`
          : s.status === "dropping"
            ? `${lockerNum} is placing your item`
            : "Checking the bay",
      );
      setWorkingSub(s.message || "");
      // Absent stays absent. Never substitute a config lookup here: an
      // admin duration_override would desync the bar from the real door.
      setWorkingDuration(
        typeof s.duration_seconds === "number" && s.duration_seconds > 0
          ? s.duration_seconds
          : undefined,
      );
      if (cur !== "working") goTo("working");
    } else if (s.status === "verifying_item") {
      setVerifyingSub(s.message || "This takes about 15 seconds.");
      if (cur !== "verifying") goTo("verifying");
    } else if (s.status === "item_verified") {
      const lockerNum = s.active_locker
        ? `Locker ${String(s.active_locker).padStart(2, "0")}`
        : "Locker";
      setSuccessSub(s.message || "Item verified");
      setSuccessInstr(`${lockerNum} — you're all set.`);
      setSuccessNote(null);
      goTo("success");
    } else if (s.status === "item_pending") {
      // D-87b. The fast check at the locker runs on a budget — a student is
      // standing here — so it skips stages and sends anything short of a clear
      // pass to a human. That is a normal outcome, not a failure, and the two
      // facts the person needs are that their item is IN and that a person
      // will confirm it. Saying only "pending manual review" read as "something
      // went wrong" and sent them looking for staff.
      const lockerNum = s.active_locker
        ? `Locker ${String(s.active_locker).padStart(2, "0")}`
        : "Locker";
      setSuccessSub(s.message || "Item placed — awaiting review");
      setSuccessInstr(`${lockerNum} is closed. You're done here.`);
      setSuccessNote(
        "Our full model is taking a closer look, then a person confirms it. " +
          "This can take a few hours — you'll be notified in the app.",
      );
      goTo("success");
    } else if (s.status === "item_retry") {
      // Was `goTo("main")`: the kiosk silently returned to the QR screen, so a
      // person who had just been told to reposition their item saw the start
      // screen instead and read it as the kiosk looping. The message is the
      // whole point of this status.
      setErrorMsg(s.message || "The kiosk could not match the item yet.");
      setErrorTone("retry");
      if (cur !== "error") goTo("error");
    } else if (s.status === "error") {
      setErrorMsg(s.message || "An error occurred. Please try again.");
      setErrorTone("error");
      if (cur !== "error") goTo("error");
    } else if (cur === "verifying" || cur === "working") {
      // D-87c — THE STRANDED SCREEN. On 2026-09-18 the Pi was updated to send a
      // new status (`item_pending`) while the browser was still running the
      // PREVIOUS JS bundle, which had no branch for it. Nothing matched, so the
      // kiosk sat on "Checking your item…" forever — and `verifying` is
      // deliberately exempt from the inactivity timeout precisely because a
      // person is told not to walk away, so nothing rescued it. The verdict had
      // arrived and been logged; only this screen never heard about it.
      //
      // Any unrecognised status while parked on a do-not-leave screen now
      // releases it instead of hanging. A person seeing a slightly generic
      // "done" is a far better failure than a person standing in a corridor
      // watching a spinner that will never stop. Deliberately does NOT fire
      // from `main`/`idle`, where an unknown status is simply noise.
      console.warn(
        `[kiosk] unrecognised status "${s.status}" while on "${cur}" — releasing the screen`,
      );
      setSuccessSub(s.message || "Done");
      setSuccessInstr("You can close the locker and go.");
      setSuccessNote(
        "If you were told your item still needs checking, that is already " +
          "under way — you will be notified in the app.",
      );
      goTo("success");
    }
  }

  // ── Screen-enter side effects (camera src, qr-mode emits, timers) ───────
  useEffect(() => {
    // `set_qr_mode` drove the kiosk's own QR-decode camera loop, deleted with
    // the face camera on 2026-09-03. Nothing consumes it any more, so the
    // emits went with the "qr"/"confirm" screens on 2026-09-06.
    if (screen === "main" || screen === "error") {
      if (screen === "main") {
        setSessionQrConnected(false);
        setSessionQrUser(null);
      }
    } else if (screen === "face") {
      setFaceProgress(0);
      let p = 0;
      const t = setInterval(() => {
        p = Math.min(p + 1.2, 90);
        setFaceProgress(p);
        if (p >= 90) clearInterval(t);
      }, 90);
      return () => clearInterval(t);
    } else if (screen === "success") {
      // D-87b: five seconds is right for "your locker is open, take your
      // item" — the person is already reaching for the door. It is not enough
      // to READ the awaiting-review note, which is three lines telling them
      // what happens over the next few hours. The dwell follows the content.
      const secs = successNote ? 12 : 5;
      let n = secs;
      setCountdown(n);
      const t = setInterval(() => {
        n -= 1;
        setCountdown(n);
        if (n <= 0) clearInterval(t);
      }, 1000);
      const done = setTimeout(() => goTo("main"), secs * 1000);
      return () => {
        clearInterval(t);
        clearTimeout(done);
      };
    }
  }, [screen, goTo, successNote]);

  const actions = {
    touchIdle: () => {
      if (screenRef.current === "idle") goTo("main");
    },
    // Cancel now TELLS the Pi. It used to only navigate locally, which the
    // next poll undid; the Pi also resets itself and closes the server
    // session so the door cannot open after the person has walked away.
    cancel: () => {
      socketRef.current?.emit("user_cancel");
      goTo("main");
    },
    retry: () => goTo("main"),
    errHome: () => goTo("main"),
    // Informational screens off the main menu (§4 — the kiosk is also a
    // promotional surface). These carry no rental state, so leaving one is
    // always a plain return to the menu.
    openHow: () => goTo("how"),
    openCatalogue: () => goTo("catalogue"),
    openLockers: () => goTo("lockers"),
    backToMain: () => goTo("main"),
    goIdle: () => goTo("idle"),
  };

  return {
    screen,
    goTo,
    offline,
    mode,
    setMode,
    lockers,
    occupancy,
    faceProgress,
    faceLabel,
    faceInstr,
    successSub,
    successInstr,
    successNote,
    countdown,
    errorMsg,
    errorTone,
    verifyingSub,
    workingKind,
    workingLabel,
    workingSub,
    workingDuration,
    sessionQrConnected,
    sessionQrUser,
    actions,
    isDemo: !!DEMO_SCREEN,
  };
}
