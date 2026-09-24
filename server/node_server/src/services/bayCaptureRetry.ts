import type { Server } from "socket.io";
import logger from "../utils/logger";

/**
 * D-103 (2026-09-24) — "Item is placed" can arrive while the bay's door is
 * still unlocking, and the capture it asks for is then refused.
 *
 * Found on the real bank: a deposit came back RETRY, the server re-opened
 * bay 1 (a 15s solenoid hold), the owner re-seated the item, shut the door
 * and tapped "Item is placed" 13.4s later. The Pi — correctly, under D-96's
 * exclusivity rule — refused to photograph a bay whose door was still held
 * open. Nothing retried, so the phone sat on "Checking the locker" waiting for
 * a verdict that could never come.
 *
 * The Pi must keep refusing: it is the guard, and a queued hardware command
 * is exactly what D-96 forbids. But the person's intent ("the item is in —
 * photograph it") is still valid a few seconds later, once the door re-locks.
 * So the SERVER, which owns that intent, re-sends the capture until the bay is
 * free, for about as long as the longest door hold plus margin.
 *
 * Only captures sent through `sendBayCapture` are retried; admin console
 * captures are one-off diagnostics and stay one-off.
 */

type PendingCapture = {
  kioskId: string;
  payload: Record<string, unknown>;
  attempts: number;
};

const pending = new Map<string, PendingCapture>();

/** Re-send every 2s, up to 12 times: ~24s, past bay 1's 15s hold + its ack. */
export const CAPTURE_RETRY_DELAY_MS = 2_000;
export const CAPTURE_MAX_ATTEMPTS = 12;

const newCommandId = () => Math.random().toString(16).slice(2, 10).toUpperCase();

export function sendBayCapture(
  io: Server,
  kioskId: string,
  lockerNumber: number,
  rentalId: string,
  numFrames = 3,
): string {
  const commandId = newCommandId();
  const payload = {
    action: "capture_image",
    command_id: commandId,
    locker_id: lockerNumber,
    num_frames: numFrames,
    rental_id: rentalId,
  };
  pending.set(commandId, { kioskId, payload, attempts: 1 });
  io.to(`kiosk:${kioskId}`).emit("kiosk:command", payload);
  return commandId;
}

/**
 * Feed every `kiosk:ack` through here. Returns true when the ack belonged to a
 * tracked capture (whatever the outcome), so the caller can log accordingly.
 */
export function handleCaptureAck(
  io: Server,
  ack: { command_id?: string; action?: string; status?: string; reason?: string },
): boolean {
  if (ack.action !== "capture_image" || !ack.command_id) return false;
  const entry = pending.get(ack.command_id);
  if (!entry) return false;

  if (ack.status !== "refused" || ack.reason !== "bay_busy") {
    // ok, error, or a refusal that waiting will not fix — stop tracking.
    pending.delete(ack.command_id);
    return true;
  }

  if (entry.attempts >= CAPTURE_MAX_ATTEMPTS) {
    pending.delete(ack.command_id);
    logger.error(
      `[D-103] capture ${ack.command_id} for rental ${String(entry.payload.rental_id)} ` +
        `still refused after ${entry.attempts} attempts — bay ${String(entry.payload.locker_id)} ` +
        `never became free. Giving up; the person must tap "Item is placed" again.`,
    );
    return true;
  }

  entry.attempts += 1;
  logger.info(
    `[D-103] capture ${ack.command_id} refused (bay busy) — re-sending in ` +
      `${CAPTURE_RETRY_DELAY_MS / 1000}s (attempt ${entry.attempts}/${CAPTURE_MAX_ATTEMPTS})`,
  );
  setTimeout(() => {
    // Re-check: the entry may have been settled while we waited.
    if (!pending.has(ack.command_id as string)) return;
    io.to(`kiosk:${entry.kioskId}`).emit("kiosk:command", entry.payload);
  }, CAPTURE_RETRY_DELAY_MS);
  return true;
}

/** Test seam only. */
export function __resetPendingCaptures(): void {
  pending.clear();
}
