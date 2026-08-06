import { AnimatePresence, motion } from "framer-motion";
import "./theme.css";
import "./screens.css";
import { useKioskState } from "./useKioskState";
import { IdleScreen } from "./components/screens/IdleScreen";
import { MainScreen } from "./components/screens/MainScreen";
import { QrScreen } from "./components/screens/QrScreen";
import { ConfirmScreen } from "./components/screens/ConfirmScreen";
import { FaceScreen } from "./components/screens/FaceScreen";
import { VerifyingScreen } from "./components/screens/VerifyingScreen";
import { SuccessScreen } from "./components/screens/SuccessScreen";
import { ErrorScreen } from "./components/screens/ErrorScreen";
import { OfflineScreen } from "./components/screens/OfflineScreen";

export default function App() {
  const k = useKioskState();

  // Offline overlays whatever screen was active rather than replacing the
  // whole router — the design mandate treats "lost connection" as its own
  // failure mode, distinct from the idle/flow state underneath it.
  // `?offline=1` forces this in demo mode for screenshot verification —
  // there's no live backend to actually disconnect from in that mode.
  const forceOffline = new URLSearchParams(window.location.search).get("offline") === "1";
  const showOffline = (k.offline && k.screen !== "idle" && !k.isDemo) || forceOffline;

  return (
    <>
      <AnimatePresence mode="wait">
        <motion.div
          key={k.screen}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
        >
          {k.screen === "idle" && <IdleScreen onTap={k.actions.touchIdle} />}
          {k.screen === "main" && (
            <MainScreen
              offline={k.offline}
              lockers={k.lockers}
              sessionQrConnected={k.sessionQrConnected}
              sessionQrUser={k.sessionQrUser}
              isDemo={k.isDemo}
            />
          )}
          {k.screen === "qr" && (
            <QrScreen onBack={k.actions.qrBack} status={k.qrStatus} isDemo={k.isDemo} />
          )}
          {k.screen === "confirm" && (
            <ConfirmScreen
              rentalInfo={k.rentalInfo}
              rentalId={k.rentalId}
              confirmAction={k.confirmAction}
              confirmNotice={k.confirmNotice}
              onBack={k.actions.confirmBack}
              onProceed={k.actions.proceed}
              onCancel={k.actions.cancel}
            />
          )}
          {k.screen === "face" && (
            <FaceScreen
              instr={k.faceInstr}
              progress={k.faceProgress}
              label={k.faceLabel}
              isDemo={k.isDemo}
            />
          )}
          {k.screen === "verifying" && <VerifyingScreen sub={k.verifyingSub} />}
          {k.screen === "success" && (
            <SuccessScreen sub={k.successSub} instr={k.successInstr} countdown={k.countdown} />
          )}
          {k.screen === "error" && (
            <ErrorScreen message={k.errorMsg} onRetry={k.actions.retry} onHome={k.actions.errHome} />
          )}
        </motion.div>
      </AnimatePresence>

      {showOffline && <OfflineScreen />}
    </>
  );
}
