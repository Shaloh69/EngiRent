import { useCallback, useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import type { KioskServerState, Mode, RentalInfo, Screen } from "./types";
import { PRE_FLOW_SCREENS } from "./types";

const IDLE_MS = 30_000; // MAIN -> IDLE
const RETURN_MS = 5 * 60_000; // flow screens -> MAIN
const OFFLINE_GRACE_MS = 4_000; // avoid flicker on a brief reconnect

const ACTION_MAP: Record<string, string> = {
  AWAITING_DEPOSIT: "Deposit item into locker",
  DEPOSITED: "Claim your rented item",
  ACTIVE: "Return item to locker",
};
const NOTICE_MAP: Record<string, string> = {
  AWAITING_DEPOSIT:
    "Identity will be verified, then the locker will open for you to deposit the item.",
  DEPOSITED:
    "Identity will be verified, then the locker will open for you to collect the item.",
  ACTIVE:
    "Identity will be verified, then the locker will open for you to return the item.",
};

/**
 * Demo mode — for local design work and screenshot verification without a
 * running Flask/Socket.IO backend. `?demo=confirm` (etc.) jumps straight to
 * a screen with realistic placeholder data instead of waiting on a live
 * connection that doesn't exist in this environment.
 */
const DEMO_SCREEN = new URLSearchParams(window.location.search).get(
  "demo",
) as Screen | null;

const DEMO_RENTAL: RentalInfo = {
  item: { title: "Scientific Calculator FX-991ES" },
  owner: { firstName: "Allan", lastName: "Mondejar" },
  status: "AWAITING_DEPOSIT",
  depositLockerId: 2,
};

export function useKioskState() {
  const [screen, setScreen] = useState<Screen>(DEMO_SCREEN ?? "idle");
  const [offline, setOffline] = useState(!DEMO_SCREEN);
  const [rentalId, setRentalId] = useState<string | null>(
    DEMO_SCREEN ? "demo-rental-id-0000000000" : null,
  );
  const [rentalInfo, setRentalInfo] = useState<RentalInfo | null>(
    DEMO_SCREEN ? DEMO_RENTAL : null,
  );
  const [mode, setMode] = useState<Mode>(DEMO_SCREEN ? "place" : null);
  const [lockers, setLockers] = useState<Record<string, boolean>>({
    "1": false,
    "2": DEMO_SCREEN === "confirm",
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
  const [countdown, setCountdown] = useState(5);
  const [errorMsg, setErrorMsg] = useState(
    "Please try again or contact staff for assistance.",
  );
  const [verifyingSub, setVerifyingSub] = useState(
    "This takes about 15 seconds.",
  );
  const [qrStatus, setQrStatus] = useState<"scanning" | "found" | "error">(
    "scanning",
  );
  const [sessionQrConnected, setSessionQrConnected] = useState(false);
  const [sessionQrUser, setSessionQrUser] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const inactTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offlineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screenRef = useRef<Screen>(screen);
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
    if (s === "idle" || s === "verifying") return;
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
      "qr_scanned",
      (data: { rental_id?: string; rental_info?: RentalInfo }) => {
        setRentalId(data.rental_id ?? "");
        setRentalInfo(data.rental_info ?? {});
        setQrStatus("found");
        setTimeout(() => {
          // The QR the phone scans is the one rendered on MainScreen, so the
          // screen at scan time is almost always "main" — never "qr" (that
          // screen is only reachable by backing out of "confirm"). Guarding on
          // "qr" alone deadlocked the whole kiosk: the session banner turned
          // green, but confirm never opened, so "user_confirm" was never sent
          // and initiate_rental_flow never ran (found 2026-09-03).
          //
          // Allow any pre-flow screen through, but not the in-flow ones —
          // "face"/"verifying"/"success" must not be yanked back to confirm by
          // a late or duplicate event.
          if (PRE_FLOW_SCREENS.includes(screenRef.current)) goTo("confirm");
        }, 700);
      },
    );

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

    const cur = screenRef.current;
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
    } else if (s.status === "verifying_item") {
      setVerifyingSub(s.message || "This takes about 15 seconds.");
      if (cur !== "verifying") goTo("verifying");
    } else if (s.status === "item_verified") {
      const lockerNum = s.active_locker
        ? `Locker ${String(s.active_locker).padStart(2, "0")}`
        : "Locker";
      setSuccessSub(s.message || "Item verified");
      setSuccessInstr(`${lockerNum} — you're all set.`);
      goTo("success");
    } else if (s.status === "item_retry") {
      goTo("main");
    } else if (s.status === "error") {
      setErrorMsg(s.message || "An error occurred. Please try again.");
      if (cur !== "error") goTo("error");
    }
  }

  // ── Screen-enter side effects (camera src, qr-mode emits, timers) ───────
  useEffect(() => {
    const socket = socketRef.current;
    if (screen === "qr") {
      socket?.emit("set_qr_mode", { active: true });
      setQrStatus("scanning");
    } else if (screen === "main" || screen === "confirm" || screen === "error") {
      socket?.emit("set_qr_mode", { active: false });
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
      let n = 5;
      setCountdown(n);
      const t = setInterval(() => {
        n -= 1;
        setCountdown(n);
        if (n <= 0) clearInterval(t);
      }, 1000);
      const done = setTimeout(() => goTo("main"), 5000);
      return () => {
        clearInterval(t);
        clearTimeout(done);
      };
    }
  }, [screen, goTo]);

  const actions = {
    touchIdle: () => {
      if (screenRef.current === "idle") goTo("main");
    },
    qrBack: () => {
      socketRef.current?.emit("set_qr_mode", { active: false });
      goTo("main");
    },
    confirmBack: () => {
      goTo("qr");
      socketRef.current?.emit("set_qr_mode", { active: true });
    },
    proceed: () => {
      if (!rentalId) return;
      socketRef.current?.emit("user_confirm", { rental_id: rentalId, mode });
      setFaceInstr("Preparing verification…");
      setFaceLabel("Please wait…");
      goTo("face");
    },
    cancel: () => goTo("main"),
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

  const confirmAction = rentalInfo?.status
    ? (ACTION_MAP[rentalInfo.status.toUpperCase()] ?? "Proceed with action")
    : "Proceed with action";
  const confirmNotice = rentalInfo?.status
    ? (NOTICE_MAP[rentalInfo.status.toUpperCase()] ??
      "Identity verification is required before access is granted.")
    : "Identity verification is required before access is granted.";

  return {
    screen,
    goTo,
    offline,
    rentalId,
    rentalInfo,
    mode,
    setMode,
    lockers,
    faceProgress,
    faceLabel,
    faceInstr,
    successSub,
    successInstr,
    countdown,
    errorMsg,
    verifyingSub,
    qrStatus,
    sessionQrConnected,
    sessionQrUser,
    confirmAction,
    confirmNotice,
    actions,
    isDemo: !!DEMO_SCREEN,
  };
}
