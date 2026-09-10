import { useEffect, useRef, useState } from "react";
import "./theme.css";
import "./screens.css";
import { useKioskState } from "./useKioskState";
import { BlockAssembly } from "./components/BlockAssembly";
import { IdleScreen } from "./components/screens/IdleScreen";
import { MainScreen } from "./components/screens/MainScreen";
import { HowScreen } from "./components/screens/HowScreen";
import { CatalogueScreen } from "./components/screens/CatalogueScreen";
import { LockersScreen } from "./components/screens/LockersScreen";
import { FaceScreen } from "./components/screens/FaceScreen";
import { VerifyingScreen } from "./components/screens/VerifyingScreen";
import { SuccessScreen } from "./components/screens/SuccessScreen";
import { ErrorScreen } from "./components/screens/ErrorScreen";
import { OfflineScreen } from "./components/screens/OfflineScreen";

export default function App() {
  const k = useKioskState();

  // Boot: the Tetris wall assembles over an empty screen, shows the mark,
  // then clears to reveal the idle attract loop.
  const [booting, setBooting] = useState(true);

  // Every screen change replays the assembly. The incoming screen is mounted
  // immediately underneath, so by the time the wall clears the new page is
  // already painted — no flash of empty layout, which matters on a Pi where
  // first paint of a heavy screen isn't instant.
  const [runKey, setRunKey] = useState(0);
  const prevScreen = useRef(k.screen);

  useEffect(() => {
    if (prevScreen.current !== k.screen) {
      prevScreen.current = k.screen;
      setRunKey((n) => n + 1);
    }
  }, [k.screen]);

  // Offline overlays whatever screen was active rather than replacing the
  // whole router — the design mandate treats "lost connection" as its own
  // failure mode, distinct from the idle/flow state underneath it.
  // `?offline=1` forces this in demo mode for screenshot verification —
  // there's no live backend to actually disconnect from in that mode.
  const forceOffline =
    new URLSearchParams(window.location.search).get("offline") === "1";
  const showOffline =
    (k.offline && k.screen !== "idle" && !k.isDemo) || forceOffline;

  // Screenshot verification needs the page visible without waiting out the
  // animation, and the Pi's own smoke test shouldn't depend on it either.
  const skipAssembly =
    new URLSearchParams(window.location.search).get("notetris") === "1";

  return (
    <>
      {k.screen === "idle" && <IdleScreen onTap={k.actions.touchIdle} />}
      {k.screen === "main" && (
        <MainScreen
          offline={k.offline}
          lockers={k.lockers}
          sessionQrConnected={k.sessionQrConnected}
          sessionQrUser={k.sessionQrUser}
          isDemo={k.isDemo}
          onHow={k.actions.openHow}
          onCatalogue={k.actions.openCatalogue}
          onLockers={k.actions.openLockers}
          onIdle={k.actions.goIdle}
        />
      )}
      {k.screen === "how" && <HowScreen onBack={k.actions.backToMain} />}
      {k.screen === "catalogue" && (
        <CatalogueScreen onBack={k.actions.backToMain} isDemo={k.isDemo} />
      )}
      {k.screen === "lockers" && (
        <LockersScreen occupancy={k.occupancy} onBack={k.actions.backToMain} />
      )}
      {k.screen === "face" && (
        <FaceScreen instr={k.faceInstr} onCancel={k.actions.cancel} />
      )}
      {k.screen === "verifying" && <VerifyingScreen sub={k.verifyingSub} />}
      {k.screen === "success" && (
        <SuccessScreen
          sub={k.successSub}
          instr={k.successInstr}
          countdown={k.countdown}
        />
      )}
      {k.screen === "error" && (
        <ErrorScreen
          message={k.errorMsg}
          onRetry={k.actions.retry}
          onHome={k.actions.errHome}
        />
      )}

      {showOffline && <OfflineScreen />}

      {!skipAssembly && booting && (
        <BlockAssembly runKey="boot" boot onFinished={() => setBooting(false)} />
      )}
      {!skipAssembly && !booting && runKey > 0 && (
        <BlockAssembly key={runKey} runKey={`${k.screen}-${runKey}`} />
      )}
    </>
  );
}
