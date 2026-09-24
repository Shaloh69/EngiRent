import express, { Application } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { createServer } from "http";
import { Server as SocketServer, Socket } from "socket.io";
import cron from "node-cron";
import env from "./config/env";
import { connectDatabase } from "./config/database";
import logger from "./utils/logger";
import { handleCaptureAck } from "./services/bayCaptureRetry";
import routes from "./routes";
import mediaRoutes from "./routes/mediaRoutes";
import { errorHandler, notFound } from "./middleware/errorHandler";
import { rateLimiter } from "./middleware/rateLimiter";
import { mediaUrlRewriter } from "./middleware/mediaUrlRewriter";
import prisma from "./config/database";
import kioskEventBus from "./utils/kioskEventBus";
import { installKioskEventLog } from "./utils/kioskEventLog";
import {
  emitLockerOccupancy,
  emitOccupancyForLockerId,
} from "./services/lockerOccupancyService";
import {
  ADMIN_ROOM,
  canJoinAdminRoom,
  notifyAdmins,
} from "./services/adminRoom";
import { verifyAccessToken } from "./utils/jwt";
// decryptFaceEncoding/signedMediaUrl were used here to ship a user's face
// encoding and reference photo down to the kiosk for local comparison. Both
// became unnecessary on 2026-09-03: the comparison now runs server-side, so
// the biometric never leaves this process. See faceVerificationService.
import { isKioskActionable, resolveFaceSubject } from "./services/faceVerificationService";
import { runMlVerification } from "./services/mlVerificationService";
import {
  attachDeepReviewEmitter,
  queueDeepReview,
} from "./services/deepReviewQueue";
import {
  longLeadPendingResult,
  mlUnreachableResult,
  verificationEvidenceFields,
} from "./services/verificationEvidence";
import { isLongLeadPickup } from "./services/pickupLaneService";
import {
  confirmStorageDrop,
  storageDropForCommand,
} from "./services/storageDropService";
import { recordCompartmentAfterCommit } from "./services/lockerCompartments";
import { runCollectionSweep } from "./services/collectionSweepService";
import { cancelOverdueUndepositedRentals } from "./services/overdueRentalCleanup";
import {
  reconcileItemAvailability,
  recomputeItemAvailability,
} from "./services/itemAvailabilityService";
import { depositVerdict, returnVerdict } from "./services/verdictPolicy";
import {
  releaseForOwnerPickup,
  dropUncollectedToLower,
  confirmRelease,
  rentalForCommand,
  noteDoorClosed,
} from "./services/retrievalService";
import {
  consumeKioskSession,
  openKioskSession,
} from "./services/kioskSessionStore";
import { recordKioskLog } from "./services/kioskLogBuffer";
import { recordTimingReport } from "./services/kioskTimingStore";
import { recordAdminSnapshot } from "./services/kioskSnapshotStore";
import { approveReturn, completeAfterOwnerPickup } from "./services/returnApprovalService";
import {
  sendItemReadyForClaim,
  sendReturnOverdue,
  sendVerificationFailed,
} from "./utils/email";

const app: Application = express();
const httpServer = createServer(app);

const ALLOWED_ORIGINS = [
  env.CLIENT_WEB_URL,
  env.CLIENT_MOBILE_URL,
  env.CLIENT_ADMIN_URL,
];

const io = new SocketServer(httpServer, {
  cors: {
    origin: ALLOWED_ORIGINS,
    credentials: true,
  },
});

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(helmet());
app.use(
  cors({
    origin: ALLOWED_ORIGINS,
    credentials: true,
  }),
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(morgan(env.NODE_ENV === "development" ? "dev" : "combined"));
// Rate limiting applies uniformly, including /admin — a prior version of this
// middleware skipped every /admin/* path, meaning admin login itself was
// completely unprotected against a brute-force password attempt. requireAdmin
// still gates *access* to admin data, but that's a separate concern from
// throttling how many login attempts an IP can make.
app.use(rateLimiter);
// Rewrites stored media paths (users/{id}/face.jpg, users/{id}/id.jpg,
// verifications/**) into real URLs on every JSON response — see
// middleware/mediaUrlRewriter.ts for why this is global instead of
// per-controller.
app.use(mediaUrlRewriter);

// Expose io to controllers
app.set("io", io);
// D-87b: the background deep-review queue reports finished runs to the admin
// room. It works without this — the result is written to the verification row
// either way — but the console would only see it on its next poll.
attachDeepReviewEmitter(io);

// ── Socket.io authentication ────────────────────────────────────────────────
// Every socket is tagged as one of: "kiosk" (Raspberry Pi, proven by the shared
// secret), "user" (mobile/web client, proven by a valid access token), or "anon".
// Privileged events (all kiosk:* hardware/verification events, user-room join,
// app-initiated kiosk scans) are gated on this tag below. This closes the hole
// where any unauthenticated socket could open a locker (kiosk:face) or drive a
// rental/payment through its state machine (kiosk:images).
if (!env.KIOSK_SHARED_SECRET) {
  logger.warn(
    "⚠️  KIOSK_SHARED_SECRET is not set — kiosk hardware events will be REFUSED " +
      "(fail-closed). Set it on both the backend and the Pi to enable the kiosk.",
  );
}

io.use((socket, next) => {
  try {
    const auth = (socket.handshake.auth ?? {}) as Record<string, unknown>;
    const headers = socket.handshake.headers;

    // 1) Kiosk — shared secret via auth payload or x-kiosk-secret header
    const kioskSecret =
      (auth.kioskSecret as string | undefined) ??
      (headers["x-kiosk-secret"] as string | undefined);
    if (
      env.KIOSK_SHARED_SECRET &&
      kioskSecret &&
      kioskSecret === env.KIOSK_SHARED_SECRET
    ) {
      socket.data.kind = "kiosk";
      socket.data.kioskId = (auth.kioskId as string | undefined) ?? undefined;
      return next();
    }

    // 2) User — access token via auth payload or Authorization header
    const bearer =
      (auth.token as string | undefined) ??
      (headers.authorization as string | undefined)?.replace(/^Bearer\s+/i, "");
    if (bearer) {
      try {
        const decoded = verifyAccessToken(bearer);
        socket.data.kind = "user";
        socket.data.userId = decoded.userId;
        socket.data.role = decoded.role;
        return next();
      } catch {
        // fall through to anon
      }
    }

    // 3) Anonymous — may connect (to receive public broadcasts) but cannot
    //    trigger any privileged event.
    socket.data.kind = "anon";
    return next();
  } catch {
    socket.data.kind = "anon";
    return next();
  }
});

/** True when the socket authenticated as a genuine kiosk. */
function isKiosk(socket: Socket): boolean {
  return socket.data?.kind === "kiosk";
}
/** True when the socket authenticated as a logged-in user. */
function isUser(socket: Socket): boolean {
  return socket.data?.kind === "user" && Boolean(socket.data?.userId);
}

// ── API routes ─────────────────────────────────────────────────────────────
app.use(`/api/${env.API_VERSION}`, routes);

// ── Local media serving (Phase 0.5 — replaces Supabase's public bucket) ─────
// Deliberately mounted outside /api/${API_VERSION} — this is asset serving,
// not a REST resource, and the rate limiter above already applies to it
// (mounted before this line) same as every other route.
app.use("/media", mediaRoutes);

// ── Error handling ─────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ML verification helpers moved to services/mlVerificationService.ts on
// 2026-09-06 so D-18 could be regression-tested — importing them from here
// booted the HTTP and socket servers. Behaviour unchanged; it is a move.

// ── A return passed the item check automatically ──────────────────────────
// E6.R (2026-09-24) — this used to go straight to COMPLETED and try to DROP the
// item to the lower compartment; at night the drop was refused and the item
// was stranded (D-107). Now the money settles here, the item is handed back to
// its owner in place, and the rental completes when the owner collects it —
// see returnApprovalService.ts.
async function completeRental(rentalId: string): Promise<void> {
  await approveReturn(io, rentalId);
}

// ── Socket.io ─────────────────────────────────────────────────────────────
io.on("connection", (socket: Socket) => {
  logger.info(`Socket connected: ${socket.id}`);

  // ── User room join (mobile app) — join ONLY the authenticated user's room.
  // The client-supplied id is ignored so a socket can't subscribe to someone
  // else's notifications.
  socket.on("join", () => {
    if (!isUser(socket)) {
      logger.warn("Rejected 'join' from non-authenticated socket");
      return;
    }
    const uid = socket.data.userId as string;
    socket.join(`user:${uid}`);
    logger.info(`User ${uid} joined their notification room`);
  });

  // ── Admin room join (admin console) — E2.2 / D-14.
  // The console had no socket client at all, which is the real reason its
  // queues never live-updated (D-4). Gated on the JWT-derived role, never on
  // anything the client sends: canJoinAdminRoom requires kind === "user",
  // which io.use() sets only after verifying the token.
  socket.on("admin:join", () => {
    if (!canJoinAdminRoom(socket.data)) {
      logger.warn(
        `Rejected 'admin:join' from socket ${socket.id} (kind=${socket.data.kind}, role=${socket.data.role})`,
      );
      // Say so, rather than leaving the caller to infer a refusal from
      // silence. A console that cannot tell "refused" from "no kiosk
      // activity yet" shows a live-looking indicator over a dead
      // subscription, which is the exact failure this work exists to remove.
      // Tells the socket nothing it does not already know about itself.
      socket.emit("admin:join_refused", { reason: "staff access required" });
      return;
    }
    socket.join(ADMIN_ROOM);
    logger.info(
      `${socket.data.role} ${socket.data.userId} joined the admin room`,
    );
    // Let the console distinguish "connected" from "connected and
    // subscribed" — without it, a silent authorization failure looks exactly
    // like a quiet period with no kiosk activity.
    socket.emit("admin:joined", { room: ADMIN_ROOM });
  });

  // ── Kiosk registration — Pi announces itself on connect (kiosk-only)
  socket.on(
    "kiosk:register",
    async (data: {
      kiosk_id: string;
      locker_count: number;
      version: string;
    }) => {
      if (!isKiosk(socket)) {
        logger.warn(
          `Rejected 'kiosk:register' from unauthenticated socket ${socket.id}`,
        );
        return;
      }
      const { kiosk_id, locker_count, version } = data;
      socket.data.kioskId = kiosk_id;
      socket.join(`kiosk:${kiosk_id}`);

      logger.info(
        `\n┌─────────────────────────────────────────────\n` +
          `│  🟢 [PI-ONLINE]  Kiosk registered\n` +
          `│  Kiosk ID : ${kiosk_id}\n` +
          `│  Socket   : ${socket.id}\n` +
          `│  Lockers  : ${locker_count ?? "?"}\n` +
          `│  Version  : ${version ?? "?"}\n` +
          `└─────────────────────────────────────────────`,
      );

      // Push stored config to Pi immediately
      try {
        const record = await prisma.kioskConfig.findUnique({
          where: { kioskId: kiosk_id },
        });
        if (record?.config) {
          socket.emit("kiosk:config", record.config);
          logger.info(`  📤 [PI-CONFIG]  Pushed stored config to ${kiosk_id}`);
        }
      } catch (err) {
        logger.error(`Failed to push config to kiosk ${kiosk_id}:`, err);
      }

      // D-53. Push current bay occupancy the moment the Pi is in its room.
      // Without this the kiosk starts every session with an empty
      // `_ui_state["occupancy"]` and — correctly, per the UI half — renders
      // every bay as UNKNOWN until the next rental transition happens to
      // change something. On a wall panel that could be hours.
      //
      // Deliberately keyed on the id the KIOSK just sent, not on anything
      // this process assumes, so a mismatch against Locker.kioskId surfaces
      // as the warning inside emitLockerOccupancy rather than as silence.
      await emitLockerOccupancy(io, kiosk_id);

      // D-37 (b): the admin socket no longer carries kiosk telemetry. The
      // kioskEventBus emit below feeds the SSE stream at
      // /admin/kiosks/events, which is what health/ and kiosk/ actually
      // read. Two transports for one stream was the duplication.
      kioskEventBus.emit("kiosk_online", {
        kiosk_id,
        socket_id: socket.id,
        ts: Date.now(),
      });
    },
  );

  // ── Kiosk ACK — Pi confirms it received and executed a command
  socket.on(
    "kiosk:ack",
    (data: {
      kiosk_id: string;
      command_id: string;
      action: string;
      // D-96 — "refused" is its own outcome and not a flavour of "error".
      // An error is the hardware failing; a refusal is the hardware being
      // protected, and the two must not read the same in a log.
      status: "ok" | "error" | "refused";
      message?: string;
      reason?: string;
      locker_id?: number;
      busy_with?: string;
    }) => {
      if (!isKiosk(socket)) return;
      const { kiosk_id, command_id, action, status, message, reason, locker_id, busy_with } =
        data;

      // D-96 — close the server's own per-bay record. This is the other half
      // of `openBay`'s `noteDoorOpen`: without it the record would only ever
      // clear by expiry, and the F2 guard would report a door open for
      // twenty seconds after it had shut.
      //
      // Every outcome clears it, deliberately. A refusal means the door never
      // opened at all; an error or a timeout means it is not going to open;
      // and "ok" means the hold has finished and the solenoid has re-locked
      // (the Pi acks `open_door` only after `unlock_for` returns).
      if (action === "open_door" && locker_id !== undefined) {
        noteDoorClosed(kiosk_id, String(locker_id));
      }

      // D-103 — a tracked "Item is placed" capture refused because the door
      // is still unlocking is re-sent once the bay is free, not dropped.
      handleCaptureAck(io, data);

      if (status === "refused") {
        logger.warn(
          `[D-96] Pi REFUSED '${action}'` +
            (locker_id !== undefined ? ` on bay ${locker_id}` : "") +
            ` — ${reason ?? "no reason given"}` +
            (busy_with ? `, bay busy with '${busy_with}'` : "") +
            ` (command_id=${command_id || "none"})`,
        );
        kioskEventBus.emit("kiosk_ack", { ...data, ts: Date.now() });
        return;
      }

      // E4.6 / F3 — `releasedAt` is written ONLY here, on a real acknowledgement
      // from the Pi. Until this fires the item is not known to have changed
      // compartments, and the retrieval flow refuses to open a bottom door.
      if (action === "drop_item" && status === "ok") {
        // Two different things produce a `drop_item`: E4.6 releasing an item
        // back to its OWNER, and E5.4 dropping a long-lead deposit into
        // storage so the upper bay can be reused. Identical hardware command,
        // completely different bookkeeping — a storage drop must NOT write
        // `releasedAt`, because that marks the item as the owner's to collect
        // and would lock the renter out of their own rental. Keyed on the
        // command id so the two can never be confused.
        if (storageDropForCommand(command_id)) {
          void confirmStorageDrop(io, command_id);
        } else {
          const rentalId = rentalForCommand(command_id);
          if (rentalId) void confirmRelease(rentalId);
        }
      }

      if (status === "ok") {
        logger.info(
          `\n┌─────────────────────────────────────────────\n` +
            `│  ✅ [PI-ACK]  Command confirmed by Pi\n` +
            `│  Kiosk     : ${kiosk_id}\n` +
            `│  Command ID: ${command_id}\n` +
            `│  Action    : ${action}\n` +
            `│  Status    : OK\n` +
            `└─────────────────────────────────────────────`,
        );
      } else {
        logger.warn(
          `\n┌─────────────────────────────────────────────\n` +
            `│  ⚠️  [PI-ACK]  Command FAILED on Pi\n` +
            `│  Kiosk     : ${kiosk_id}\n` +
            `│  Command ID: ${command_id}\n` +
            `│  Action    : ${action}\n` +
            `│  Error     : ${message ?? "unknown"}\n` +
            `└─────────────────────────────────────────────`,
        );
      }
      kioskEventBus.emit("kiosk_ack", { ...data, ts: Date.now() });
    },
  );

  // ── Kiosk status update
  // ── Someone at the kiosk pressed Cancel ─────────────────────────────────────────
  //
  // Cancel used to be purely local to the kiosk screen: it navigated to the
  // main screen and told nobody. The Pi kept reporting the old status, the
  // screen's 2-second poll pulled it straight back, and the server's session
  // stayed open. That last part is the one that matters for safety: an open
  // session means the phone can still complete face verification after the
  // person has walked away from the kiosk, and the door then opens in a
  // public corridor with nobody standing at it (G11). Ending the session here
  // closes that. Found 2026-09-18 during the second physical test.
  //
  // Kiosk-authenticated only, like every other kiosk:* event. The rental id is
  // the one the Pi recorded from its own await_phone_verification command, so
  // a client cannot cancel someone else's session through this path.
  socket.on("kiosk:flow_cancel", (data: { rental_id?: string }) => {
    if (!isKiosk(socket)) return;
    const rentalId = data?.rental_id;
    if (!rentalId) return;
    consumeKioskSession(rentalId);
    logger.info(`[PI-FLOW]  Cancelled at the kiosk — session closed for rental ${rentalId}`);
    void prisma.rental
      .findUnique({ where: { id: rentalId }, select: { ownerId: true, renterId: true } })
      .then((r) => {
        if (!r) return;
        // Whichever party was mid-verification. The phone may not listen for
        // this yet — harmless if so: its next verify attempt now fails with an
        // expired session instead of opening a door.
        for (const uid of [r.ownerId, r.renterId]) {
          if (uid) io.to(`user:${uid}`).emit("kiosk:cancelled", { rentalId });
        }
      })
      .catch(() => {});
  });

  socket.on("kiosk:status", (data: unknown) => {
    if (!isKiosk(socket)) return;
    const d = data as Record<string, unknown>;
    const ui = d?.ui_state as Record<string, unknown> | undefined;
    const lockers = ui?.lockers as
      | Record<string, Record<string, string>>
      | undefined;
    const lockerSummary = lockers
      ? Object.entries(lockers)
          .map(
            ([id, doors]) =>
              `L${id}[main:${doors.main ?? "?"}|bottom:${doors.bottom ?? "?"}]`,
          )
          .join("  ")
      : "?";
    logger.info(
      `\n┌─────────────────────────────────────────────\n` +
        `│  📡 [PI-STATUS]  Kiosk state update\n` +
        `│  Kiosk   : ${d?.kiosk_id ?? "?"}\n` +
        `│  UI      : ${ui?.status ?? "?"} — ${ui?.message ?? ""}\n` +
        `│  Lockers : ${lockerSummary}\n` +
        `└─────────────────────────────────────────────`,
    );
    kioskEventBus.emit("kiosk_status", { ...d, ts: Date.now() });
  });

  // ── Kiosk images — Pi finished capturing, URLs come back here
  // Bridge: run ML verification and advance the rental
  socket.on(
    "kiosk:images",
    async (data: {
      kiosk_id: string;
      locker_id: number;
      image_urls: string[];
      rental_id?: string;
    }) => {
      if (!isKiosk(socket)) {
        logger.warn(
          `Rejected 'kiosk:images' from unauthenticated socket ${socket.id}`,
        );
        return;
      }
      const { rental_id, image_urls, locker_id } = data;

      if (!rental_id) {
        logger.warn("kiosk:images received without rental_id — ignoring");
        return;
      }

      logger.info(
        `\n┌─────────────────────────────────────────────\n` +
          `│  📸 [PI-IMAGES]  Kiosk sent captured images\n` +
          `│  Kiosk    : ${data.kiosk_id}\n` +
          `│  Rental   : ${rental_id}\n` +
          `│  Locker   : ${locker_id}\n` +
          `│  Images   : ${image_urls.length} file(s)\n` +
          `└─────────────────────────────────────────────`,
      );

      try {
        const rental = await prisma.rental.findUnique({
          where: { id: rental_id },
          include: { item: true },
        });

        if (!rental) {
          logger.warn(`kiosk:images — rental ${rental_id} not found`);
          return;
        }

        // ── DEPOSIT flow ─────────────────────────────────────────────────
        if (rental.status === "AWAITING_DEPOSIT") {
          const lockerId = String(locker_id);
          const locker = await prisma.locker.findFirst({
            where: { lockerNumber: lockerId },
          });

          const attemptNumber = rental.depositAttemptCount + 1;
          let mlResult: Awaited<ReturnType<typeof runMlVerification>>;
          let mlError: string | null = null;

          // E5.3 — WHICH LANE DECIDES THIS DEPOSIT.
          //
          // A pick-up that is days away is decided by the FULL run, never the
          // fast one. The fast lane exists only because someone is standing at
          // an open door; it pays for that speed by skipping stages worth 40%
          // of the score, which is why it structurally cannot approve anything
          // (D-87b). When nobody is waiting, that trade buys nothing.
          //
          // The owner IS still standing here though, so the full run is not
          // performed inline — it would hold them for 30-95s. The deposit
          // completes now, and `queueDeepReview` below decides moments later,
          // auto-approving at >= 85 or handing it to a human.
          const longLead = isLongLeadPickup(rental.pickupDate);

          if (longLead) {
            logger.info(
              `Deposit for rental ${rental_id} is a long-lead pick-up ` +
                `(${rental.pickupDate?.toISOString() ?? "?"}) — skipping the fast ` +
                `check; the full run decides.`,
            );
            mlResult = longLeadPendingResult();
          } else {
            try {
              mlResult = await runMlVerification(
                rental.item.images as string[],
                image_urls,
                attemptNumber,
                rental.item.mlFeatures,
              );
            } catch (err) {
              mlError = (err as Error).message;
              // D-65: the ML service itself was unreachable. Tag it, or this
              // row is indistinguishable from a genuine zero-confidence match.
              mlResult = mlUnreachableResult();
            }
          }

          // D-89 — the user's ruling: below 85, on any day, a person decides.
          // A RETRY is honoured once (a genuine placement problem); after
          // that, and for any REJECTED, the deposit goes to review instead of
          // looping the door or cancelling a paid rental on a quick check.
          const verdict = depositVerdict(mlResult.decision, attemptNumber);
          const decision = verdict.decision;
          const { confidence, method_scores } = mlResult;
          if (verdict.escalated) {
            logger.info(
              `Deposit verdict for rental ${rental_id} ESCALATED to review: ` +
                `quick check said ${mlResult.decision} ${confidence} on attempt ${attemptNumber}`,
            );
          }

          if (decision === "RETRY") {
            await prisma.rental.update({
              where: { id: rental_id },
              data: { depositAttemptCount: { increment: 1 } },
            });
            // Tell the kiosk's own screen the verification result, separate
            // from the physical door command above — closes the gap where
            // the kiosk previously went straight back to "idle" the instant
            // it uploaded images, before this (multi-second) ML decision
            // ever came back (see kiosk_ui's new "verifying" screen).
            socket.emit("kiosk:command", {
              action: "verification_done",
              result: "retry",
              locker_id,
            });
            socket.emit("kiosk:command", {
              action: "open_door",
              locker_id,
              door: "main_door",
            });
            io.to(`user:${rental.ownerId}`).emit("deposit:retry", {
              rentalId: rental_id,
              attemptNumber,
              confidence,
            });
            return;
          }

          if (decision === "REJECTED") {
            await prisma.rental.update({
              where: { id: rental_id },
              data: { depositAttemptCount: { increment: 1 } },
            });
            const verification = await prisma.verification.create({
              data: {
                originalImages: rental.item.images as never,
                kioskImages: image_urls as never,
                decision: "REJECTED",
                confidenceScore: confidence,
                attemptNumber,
                traditionalScore: method_scores?.traditional_best,
                siftScore: method_scores?.sift_combined,
                deepLearningScore: method_scores?.deep_learning_aggregated,
                status: "REJECTED",
                ...verificationEvidenceFields(mlResult), // D-65
              },
            });
            await prisma.rental.update({
              where: { id: rental_id },
              data: {
                status: "CANCELLED",
                depositVerificationId: verification.id,
                verificationScore: confidence,
                verificationStatus: "REJECTED",
              },
            });
            await recomputeItemAvailability(rental.itemId);
            // E4.6 / R4 (was D-67a). The bay used to be set AVAILABLE here
            // while the owner's item was still physically inside it, and no
            // door was reopened — so the item was sealed in a bay the database
            // called empty, and the next deposit could be assigned to it.
            // Release it to the owner instead.
            // E6.S (user ruling 2026-09-24) - handed back IN PLACE for the owner to collect
            // in person, at any hour; it drops later only if they never come
            // (dropUncollectedToLower). A policy-gated drop here was refused at night
            // and never retried (D-107's shape).
            await releaseForOwnerPickup(io, rental_id, "DEPOSIT_REJECTED");
            await prisma.notification.create({
              data: {
                userId: rental.renterId,
                title: "Rental Cancelled",
                message: `Deposit for ${rental.item.title} was rejected after ${attemptNumber} attempts.`,
                type: "VERIFICATION_FAILED",
                relatedEntityId: rental_id,
                relatedEntityType: "rental",
              },
            });
            socket.emit("kiosk:command", {
              action: "verification_done",
              result: "rejected",
              locker_id,
            });
            io.to(`user:${rental.ownerId}`).emit("deposit:rejected", {
              rentalId: rental_id,
            });
            io.to(`user:${rental.renterId}`).emit("deposit:rejected", {
              rentalId: rental_id,
            });
            return;
          }

          // APPROVED or PENDING — proceed with deposit
          const verification = await prisma.verification.create({
            data: {
              originalImages: rental.item.images as never,
              kioskImages: image_urls as never,
              decision: decision as never,
              confidenceScore: confidence,
              attemptNumber,
              traditionalScore: method_scores?.traditional_best,
              siftScore: method_scores?.sift_combined,
              deepLearningScore: method_scores?.deep_learning_aggregated,
              status: decision === "APPROVED" ? "APPROVED" : "MANUAL_REVIEW",
              ...verificationEvidenceFields(mlResult), // D-65
              ...((mlError || verdict.note) && {
                reviewNotes: [mlError && `ML error: ${mlError}`, verdict.note]
                  .filter(Boolean)
                  .join(" "),
              }),
            },
          });

          // D-87b: the verdict above came from the FAST tier — a student was
          // standing at an open locker, so stages that did not fit were
          // skipped. If it is going to a human, give that human the full
          // pipeline's opinion too. Fire-and-forget: it takes minutes, and the
          // deposit below must not wait for it.
          if (decision !== "APPROVED") {
            void queueDeepReview({
              verificationId: verification.id,
              rentalId: rental_id,
              originalUrls: rental.item.images as string[],
              kioskUrls: image_urls,
              attemptNumber,
              mlFeatures: rental.item.mlFeatures,
            });
          }

          await prisma.rental.update({
            where: { id: rental_id },
            data: {
              status: "DEPOSITED",
              ...(locker && { depositLockerId: locker.id }),
              depositedAt: new Date(),
              depositVerificationId: verification.id,
              verificationScore: confidence,
              verificationStatus:
                decision === "APPROVED" ? "APPROVED" : "MANUAL_REVIEW",
            },
          });

          if (locker) {
            // E5 — the deposited item is in the UPPER compartment. Through the
            // single writer so the compartment columns that assignment reads
            // stay in step with the whole-bay status (lockerCompartments.ts).
            await recordCompartmentAfterCommit(
              locker.id,
              "top",
              { status: "OCCUPIED", rentalId: rental_id },
              { lastUsedAt: new Date() },
            );
            // D-53: deposit accepted — the bay now holds an item.
            await emitLockerOccupancy(io, locker.kioskId);
          }

          // D-87d: only say "ready for pickup" when it actually IS. This block
          // used to run for PENDING too, so a renter got a notification and an
          // email telling them to come and collect an item no one had
          // confirmed — and, after D-87b, that was every single deposit. The
          // ready-for-claim announcement now belongs to whoever grants the
          // approval: deepReviewQueue when the full model clears it, or
          // adminController when a human does.
          if (decision === "APPROVED") {
            await prisma.notification.create({
              data: {
                userId: rental.renterId,
                title: "Item Ready for Claim",
                message: `${rental.item.title} has been deposited and is ready for pickup.`,
                type: "ITEM_READY_FOR_CLAIM",
                relatedEntityId: rental_id,
                relatedEntityType: "rental",
              },
            });

            // Feature caching for this item already happened at listing time
            // (itemController.createItem/updateItem → extractAndCacheMlFeatures);
            // persisting the verification *result* here into Item.mlFeatures was
            // removed — it wrote the wrong shape (hybrid.py expects
            // {traditional, deep, ocr_texts, image_count}, not a decision/score
            // object) and never actually served as a usable cache.
            const renterUser = await prisma.user.findUnique({
              where: { id: rental.renterId },
              select: { email: true, firstName: true },
            });
            if (renterUser) {
              await sendItemReadyForClaim(renterUser.email, {
                firstName: renterUser.firstName,
                itemTitle: rental.item.title,
                rentalId: rental_id,
              });
            }
          } else {
            // The owner has done their part and the item is physically in the
            // bay. Tell the renter the truth: it is in, it is being confirmed,
            // and they will hear when they can fetch it.
            await prisma.notification.create({
              data: {
                userId: rental.renterId,
                title: "Item dropped off — being confirmed",
                message:
                  `${rental.item.title} is in the locker. We're confirming it matches ` +
                  `the listing before you collect it — you'll be notified as soon as it's ready.`,
                type: "ITEM_READY_FOR_CLAIM",
                relatedEntityId: rental_id,
                relatedEntityType: "rental",
              },
            });
          }

          socket.emit("kiosk:command", {
            action: "verification_done",
            result: decision === "APPROVED" ? "approved" : "pending",
            locker_id,
          });
          io.to(`user:${rental.renterId}`).emit("deposit:approved", {
            rentalId: rental_id,
            decision,
            confidence,
          });
          io.to(`user:${rental.ownerId}`).emit("deposit:approved", {
            rentalId: rental_id,
            decision,
            confidence,
          });
          logger.info(`Deposit ${decision} for rental ${rental_id}`);
        }

        // ── RETURN flow ──────────────────────────────────────────────────
        else if (rental.status === "ACTIVE") {
          const lockerId = String(locker_id);
          const locker = await prisma.locker.findFirst({
            where: { lockerNumber: lockerId },
          });

          const attemptNumber = rental.returnAttemptCount + 1;
          let mlResult: Awaited<ReturnType<typeof runMlVerification>>;
          let mlError: string | null = null;

          try {
            mlResult = await runMlVerification(
              rental.item.images as string[],
              image_urls,
              attemptNumber,
              rental.item.mlFeatures,
            );
          } catch (err) {
            mlError = (err as Error).message;
            // D-65: the ML service itself was unreachable. Tag it, or this
            // row is indistinguishable from a genuine zero-confidence match.
            mlResult = mlUnreachableResult();
          }

          // D-89 — same retry cap on a return; REJECTED already goes to a
          // person here (DISPUTED), so it is left as it was.
          const verdict = returnVerdict(mlResult.decision, attemptNumber);
          const decision = verdict.decision;
          const { confidence, method_scores } = mlResult;
          if (verdict.escalated) {
            logger.info(
              `Return verdict for rental ${rental_id} ESCALATED to review: ` +
                `quick check said ${mlResult.decision} ${confidence} on attempt ${attemptNumber}`,
            );
          }

          if (decision === "RETRY") {
            await prisma.rental.update({
              where: { id: rental_id },
              data: { returnAttemptCount: { increment: 1 } },
            });
            socket.emit("kiosk:command", {
              action: "verification_done",
              result: "retry",
              locker_id,
            });
            socket.emit("kiosk:command", {
              action: "open_door",
              locker_id,
              door: "main_door",
            });
            io.to(`user:${rental.renterId}`).emit("return:retry", {
              rentalId: rental_id,
              attemptNumber,
              confidence,
            });
            return;
          }

          if (decision === "REJECTED") {
            await prisma.rental.update({
              where: { id: rental_id },
              data: { returnAttemptCount: { increment: 1 } },
            });
            const verification = await prisma.verification.create({
              data: {
                originalImages: rental.item.images as never,
                kioskImages: image_urls as never,
                decision: "REJECTED",
                confidenceScore: confidence,
                attemptNumber,
                traditionalScore: method_scores?.traditional_best,
                siftScore: method_scores?.sift_combined,
                deepLearningScore: method_scores?.deep_learning_aggregated,
                status: "REJECTED",
                ...verificationEvidenceFields(mlResult), // D-65
              },
            });
            await prisma.rental.update({
              where: { id: rental_id },
              data: {
                status: "DISPUTED",
                verificationId: verification.id,
                verificationScore: confidence,
                verificationStatus: "REJECTED",
                returnedAt: new Date(),
                actualReturnDate: new Date(),
              },
            });
            // E4.6 / R5 (was D-67b). Same defect as R4 and worse: the
            // disputed item — the object the dispute is about — was sealed in
            // a bay marked AVAILABLE. Release it to the owner pending
            // settlement.
            // E6.S (user ruling 2026-09-24) - handed back IN PLACE for the owner to collect
            // in person, at any hour; it drops later only if they never come
            // (dropUncollectedToLower). A policy-gated drop here was refused at night
            // and never retried (D-107's shape).
            await releaseForOwnerPickup(io, rental_id, "RETURN_DISPUTED");
            await prisma.notification.create({
              data: {
                userId: rental.ownerId,
                title: "Return Disputed",
                message: `Returned item for ${rental.item.title} did not match verification. Admin will review.`,
                type: "VERIFICATION_FAILED",
                relatedEntityId: rental_id,
                relatedEntityType: "rental",
              },
            });

            // Email renter about failed verification
            const renterDisp = await prisma.user.findUnique({
              where: { id: rental.renterId },
              select: { email: true, firstName: true },
            });
            if (renterDisp) {
              await sendVerificationFailed(renterDisp.email, {
                firstName: renterDisp.firstName,
                itemTitle: rental.item.title,
                rentalId: rental_id,
                reason: "return",
              });
            }

            socket.emit("kiosk:command", {
              action: "verification_done",
              result: "rejected",
              locker_id,
            });
            io.to(`user:${rental.renterId}`).emit("return:disputed", {
              rentalId: rental_id,
            });
            io.to(`user:${rental.ownerId}`).emit("return:disputed", {
              rentalId: rental_id,
            });
            // E2.2 — the disputes queue is the one an admin is expected to
            // work promptly (a student's deposit is held until it settles),
            // and it was the queue with no live signal at all.
            notifyAdmins(io, "admin:dispute_opened", {
              rentalId: rental_id,
              itemTitle: rental.item.title,
              confidence,
              openedAt: new Date().toISOString(),
            });
            return;
          }

          // APPROVED or PENDING
          const verification = await prisma.verification.create({
            data: {
              originalImages: rental.item.images as never,
              kioskImages: image_urls as never,
              decision: decision as never,
              confidenceScore: confidence,
              attemptNumber,
              traditionalScore: method_scores?.traditional_best,
              siftScore: method_scores?.sift_combined,
              deepLearningScore: method_scores?.deep_learning_aggregated,
              status: decision === "APPROVED" ? "APPROVED" : "MANUAL_REVIEW",
              ...verificationEvidenceFields(mlResult), // D-65
              ...((mlError || verdict.note) && {
                reviewNotes: [mlError && `ML error: ${mlError}`, verdict.note]
                  .filter(Boolean)
                  .join(" "),
              }),
            },
          });

          const verificationStatus =
            decision === "APPROVED" ? "APPROVED" : "MANUAL_REVIEW";

          // D-87b — same as the deposit branch: a returning item judged on the
          // fast tier goes to a human with the full run's second opinion
          // following behind it.
          if (decision !== "APPROVED") {
            void queueDeepReview({
              verificationId: verification.id,
              rentalId: rental_id,
              originalUrls: rental.item.images as string[],
              kioskUrls: image_urls,
              attemptNumber,
              mlFeatures: rental.item.mlFeatures,
            });
          }

          await prisma.rental.update({
            where: { id: rental_id },
            data: {
              status: "VERIFICATION",
              ...(locker && { returnLockerId: locker.id }),
              returnedAt: new Date(),
              actualReturnDate: new Date(),
              verificationId: verification.id,
              verificationScore: confidence,
              verificationStatus,
            },
          });

          if (locker) {
            // E5 — the returned item sits in the UPPER compartment.
            await recordCompartmentAfterCommit(
              locker.id,
              "top",
              { status: "OCCUPIED", rentalId: rental_id },
              { lastUsedAt: new Date() },
            );
            // D-53: returned item is now sitting in the bay awaiting the owner.
            await emitLockerOccupancy(io, locker.kioskId);
          }

          socket.emit("kiosk:command", {
            action: "verification_done",
            result: decision === "APPROVED" ? "approved" : "pending",
            locker_id,
          });

          if (decision === "APPROVED") {
            await completeRental(rental_id);
          } else {
            // PENDING — notify admin for manual review
            await prisma.notification.create({
              data: {
                userId: rental.ownerId,
                title: "Item Returned — Under Review",
                message: `${rental.item.title} return requires manual verification (confidence: ${confidence.toFixed(1)}%).`,
                type: "RETURN_REMINDER",
                relatedEntityId: rental_id,
                relatedEntityType: "rental",
              },
            });
            io.to(`user:${rental.renterId}`).emit("return:under_review", {
              rentalId: rental_id,
              confidence,
            });
          }

          logger.info(`Return ${decision} for rental ${rental_id}`);
        } else {
          logger.warn(
            `kiosk:images for rental ${rental_id} in unexpected status: ${rental.status}`,
          );
        }
      } catch (err) {
        logger.error(
          `kiosk:images handler error for rental ${rental_id}:`,
          err,
        );
      }
    },
  );

  // ── Kiosk face result — Pi sends after capture_face command
  // Gate: if verified → open main door + advance rental to ACTIVE
  socket.on(
    "kiosk:face",
    async (data: {
      kiosk_id: string;
      rental_id?: string;
      user_id?: string;
      detected: boolean;
      verified: boolean;
      confidence: number;
      face_url?: string;
      error?: string | null;
    }) => {
      if (!isKiosk(socket)) {
        logger.warn(
          `Rejected 'kiosk:face' from unauthenticated socket ${socket.id}`,
        );
        return;
      }
      const { rental_id, user_id, detected, verified, confidence, error } =
        data;

      // The kiosk substitutes a materially weaker local Haar-cascade
      // confidence check (see face_service.py) when the real ML dlib
      // comparison is unreachable — previously this happened with no signal
      // anywhere that a security-relevant degradation had occurred. The
      // string match against face_service.py's own wording is the current
      // signal since there's no dedicated boolean field on the wire yet;
      // logged loudly and persisted as an admin notification either way, so
      // it's genuinely visible rather than silent.
      const usedFallback = Boolean(
        error && /local fallback used/i.test(error),
      );

      logger.info(
        `\n┌─────────────────────────────────────────────\n` +
          `│  👤 [PI-FACE]  Face verification result\n` +
          `│  Kiosk      : ${data.kiosk_id}\n` +
          `│  Rental     : ${rental_id}\n` +
          `│  User       : ${user_id ?? "?"}\n` +
          `│  Detected   : ${detected}\n` +
          `│  Verified   : ${verified}\n` +
          `│  Confidence : ${(confidence * 100).toFixed(1)}%\n` +
          `${usedFallback ? `│  ⚠ WEAKER LOCAL FALLBACK USED — ${error}\n` : ""}` +
          `└─────────────────────────────────────────────`,
      );

      if (usedFallback) {
        logger.warn(
          `Kiosk ${data.kiosk_id} used the weaker local face-match fallback for rental ${rental_id ?? "?"} — ML service was unreachable.`,
        );
        kioskEventBus.emit("kiosk_error", {
          kiosk_id: data.kiosk_id,
          message: `Weaker local face-match fallback used (ML service unreachable) for rental ${rental_id ?? "unknown"}`,
          ts: Date.now(),
        });
      }

      if (!rental_id) return;

      try {
        const rental = await prisma.rental.findUnique({
          where: { id: rental_id },
          include: { item: true },
        });
        if (!rental) return;

        if (!verified) {
          // kioskId is threaded through so a "my face wasn't recognised"
          // feedback report (checklist Stage 3) can name which physical
          // kiosk it happened at — the phone app has no other way to know,
          // since it only ever talks to Node, never directly to a kiosk.
          io.to(`user:${rental.renterId}`).emit("face:failed", {
            rentalId: rental_id,
            confidence,
            kioskId: data.kiosk_id,
          });
          return;
        }

        // ── Claim: advance DEPOSITED → ACTIVE
        if (rental.status === "DEPOSITED") {
          await prisma.rental.update({
            where: { id: rental_id },
            data: { status: "ACTIVE", claimedAt: new Date() },
          });

          // Open the locker door for the renter
          socket.emit("kiosk:command", {
            action: "open_door",
            locker_id: rental.depositLockerId,
            door: "main_door",
          });

          if (rental.depositLockerId) {
            // E5 — the renter took the item out through main_door, so only the
            // UPPER compartment is freed. Writing the whole-bay status to
            // AVAILABLE here would also have hidden a stored item below.
            await recordCompartmentAfterCommit(rental.depositLockerId, "top", {
              status: "AVAILABLE",
              rentalId: null,
            });
            // D-53: renter has collected — the bay is genuinely free again.
            // Only the locker's primary key is in scope here, so the kiosk is
            // resolved from it rather than assumed.
            await emitOccupancyForLockerId(io, rental.depositLockerId);
          }

          await prisma.notification.create({
            data: {
              userId: rental.ownerId,
              title: "Item Claimed",
              message: `Your ${rental.item.title} has been claimed by the renter.`,
              type: "RENTAL_STARTED",
              relatedEntityId: rental_id,
              relatedEntityType: "rental",
            },
          });

          io.to(`user:${rental.renterId}`).emit("face:verified", {
            rentalId: rental_id,
            action: "claim",
            kioskId: data.kiosk_id,
          });
          io.to(`user:${rental.ownerId}`).emit("rental:active", {
            rentalId: rental_id,
          });
          logger.info(`Claim approved for rental ${rental_id}`);
        }

        // ── Return: face verified, now request image capture
        else if (rental.status === "ACTIVE") {
          const returnLockerId =
            rental.returnLockerId ?? rental.depositLockerId;
          socket.emit("kiosk:command", {
            action: "capture_image",
            locker_id: returnLockerId,
            num_frames: 3,
            rental_id,
          });
          io.to(`user:${rental.renterId}`).emit("face:verified", {
            rentalId: rental_id,
            action: "return",
            kioskId: data.kiosk_id,
          });
        }
      } catch (err) {
        logger.error(`kiosk:face handler error for rental ${rental_id}:`, err);
      }
    },
  );

  // ── Rental lookup — Pi scanned a QR code and needs the rental details
  socket.on(
    "kiosk:rental_lookup",
    async (data: { kiosk_id: string; rental_id: string }) => {
      if (!isKiosk(socket)) return;
      try {
        const rental = await prisma.rental.findUnique({
          where: { id: data.rental_id },
          include: {
            item: { select: { title: true, images: true } },
            owner: { select: { firstName: true, lastName: true } },
            renter: { select: { firstName: true, lastName: true } },
          },
        });

        socket.emit("kiosk:rental_info", {
          rental_id: data.rental_id,
          rental_info: rental
            ? {
                id: rental.id,
                status: rental.status,
                depositLockerId: rental.depositLockerId,
                claimLockerId: rental.claimLockerId,
                returnLockerId: rental.returnLockerId,
                item: rental.item,
                owner: rental.owner,
                renter: rental.renter,
              }
            : null,
        });
      } catch (err) {
        logger.error(`kiosk:rental_lookup error for ${data.rental_id}:`, err);
        socket.emit("kiosk:rental_info", {
          rental_id: data.rental_id,
          rental_info: null,
        });
      }
    },
  );

  // ── Admin snapshot — Pi captured an image without a rental_id
  // Relay the URL to the admin dashboard via SSE (no ML)
  socket.on(
    "kiosk:admin_snapshot",
    (data: { kiosk_id: string; locker_id: number; image_urls: string[] }) => {
      if (!isKiosk(socket)) return;
      const { kiosk_id, locker_id, image_urls } = data;
      logger.info(
        `\n┌─────────────────────────────────────────────\n` +
          `│  📷 [PI-SNAPSHOT]  Admin snapshot received\n` +
          `│  Kiosk  : ${kiosk_id}\n` +
          `│  Locker : ${locker_id}\n` +
          `│  Images : ${image_urls?.length ?? 0} file(s)\n` +
          `└─────────────────────────────────────────────`,
      );
      // D-86: kept so the console can poll for it — the event below never
      // reaches the browser through the Cloudflare tunnel.
      recordAdminSnapshot(data);
      kioskEventBus.emit("kiosk_admin_snapshot", { ...data, ts: Date.now() });
    },
  );

  // ── Kiosk-initiated rental flow — student scanned QR and confirmed on screen
  // Look up rental status → send appropriate capture_face command back
  socket.on(
    "kiosk:flow_start",
    async (data: { kiosk_id: string; rental_id: string }) => {
      if (!isKiosk(socket)) return;
      const { rental_id } = data;
      logger.info(`[PI-FLOW]  flow_start for rental ${rental_id}`);

      try {
        const rental = await prisma.rental.findUnique({
          where: { id: rental_id },
          include: {
            owner: {
              select: {
                id: true,
                profileImage: true,
                firstName: true,
                faceEncoding: true,
              },
            },
            renter: {
              select: {
                id: true,
                profileImage: true,
                firstName: true,
                faceEncoding: true,
              },
            },
          },
        });

        if (!rental) {
          socket.emit("kiosk:command", {
            action: "flow_error",
            message: "Rental not found – please contact staff",
          });
          return;
        }

        // E6.R — the same predicate verifyFace uses: the three statuses, or an
        // item released and waiting for its owner whatever the status says.
        if (!isKioskActionable(rental)) {
          socket.emit("kiosk:command", {
            action: "flow_error",
            message: `Rental status "${rental.status}" is not actionable at kiosk`,
          });
          return;
        }

        // D-87d: stop an unconfirmed claim at the door of the flow, before the
        // renter is sent to their phone to verify a face for a bay that will
        // then refuse to open. `resolveFaceSubject`/`processFaceVerification`
        // enforce this too — that is the real boundary — but failing here gives
        // the person a straight answer at the kiosk instead of walking them
        // through identity verification first and refusing at the end.
        if (
          rental.status === "DEPOSITED" &&
          rental.verificationStatus !== "APPROVED"
        ) {
          socket.emit("kiosk:command", {
            action: "flow_error",
            message:
              "This item is still being confirmed — you'll be notified when it's ready to collect",
          });
          logger.info(
            `[PI-FLOW]  Claim blocked for rental ${rental_id}: deposit not confirmed ` +
              `(verificationStatus=${rental.verificationStatus ?? "null"})`,
          );
          return;
        }

        // Face verification moved off the kiosk on 2026-09-03 (design mandate
        // §2.13) — the kiosk's face camera is physically gone. So instead of
        // commanding the Pi to capture, tell the *phone* to open its
        // verification page, and leave the kiosk waiting.
        //
        // Note what is no longer sent anywhere: the decrypted face encoding.
        // It used to be pushed to the kiosk over the socket so the Pi could
        // run the comparison itself. Now the comparison happens in this
        // process (see faceVerificationService), so the biometric never
        // leaves the server at all — strictly less exposure than before.
        const subject = resolveFaceSubject(rental);

        if (!subject.userId) {
          socket.emit("kiosk:command", {
            action: "flow_error",
            message: "Could not determine who needs to verify — contact staff",
          });
          return;
        }

        // Open the session THIS event's own validation earns: the kiosk only
        // ever emits kiosk:flow_start after checking the scanned token's
        // signature and TTL itself (validate_qr_token_internal, Pi-side).
        // Everything downstream of here — verify-face, the door command —
        // trusts this record and nothing the phone sends. See
        // kioskSessionStore.ts.
        const session = openKioskSession(
          rental_id,
          data.kiosk_id,
          subject.userId,
        );

        io.to(`user:${subject.userId}`).emit("kiosk:face_required", {
          rentalId: rental_id,
          kioskId: data.kiosk_id,
          // E3.2 / spec 2.3 -- the 120s session countdown. Sent as an ABSOLUTE
          // epoch-ms deadline, not a duration, and that distinction is the
          // whole point: a phone counting down from its own `120` would start
          // its clock when the event ARRIVES, so network and render latency
          // make it consistently show more time than is left. It would tell a
          // student "40s remaining" on a session the server has already
          // expired. An absolute deadline cannot drift that way.
          expiresAt: session.expiresAt,
          action:
            rental.releaseRequestedAt != null && rental.retrievedAt == null
              ? "retrieve"
              : rental.status === "AWAITING_DEPOSIT"
                ? "deposit"
                : rental.status === "DEPOSITED"
                  ? "claim"
                  : "return",
        });

        socket.emit("kiosk:command", {
          action: "await_phone_verification",
          rental_id,
          message: "Check your phone — we're verifying it's you",
        });

        logger.info(
          `[PI-FLOW]  Face verification handed to phone for rental ${rental_id} ` +
            `(user=${subject.userId}, status=${rental.status})`,
        );
      } catch (err) {
        logger.error(`kiosk:flow_start error for rental ${rental_id}:`, err);
        socket.emit("kiosk:command", {
          action: "flow_error",
          message: "Server error – please try again",
        });
      }
    },
  );

  // ── Kiosk error passthrough
  socket.on("kiosk:error", (data: unknown) => {
    if (!isKiosk(socket)) return;
    const d = data as Record<string, unknown>;
    logger.warn(
      `\n┌─────────────────────────────────────────────\n` +
        `│  ❌ [PI-ERROR]  Kiosk reported an error\n` +
        `│  Kiosk  : ${d?.kiosk_id ?? "?"}\n` +
        `│  Error  : ${d?.message ?? JSON.stringify(data)}\n` +
        `└─────────────────────────────────────────────`,
    );
    kioskEventBus.emit("kiosk_error", { ...d, ts: Date.now() });
  });

  // ── Hardware self-test result — Pi reports back after a "self_test"
  // kiosk:command (see adminController.sendKioskCommand), relayed to the
  // admin Health Check page via the existing SSE stream (kiosk_self_test
  // event) rather than a new channel.
  socket.on("kiosk:self_test_result", (data: unknown) => {
    if (!isKiosk(socket)) return;
    const d = data as Record<string, unknown>;
    logger.info(
      `[SELF-TEST] kiosk=${d?.kiosk_id ?? "?"} command_id=${d?.command_id ?? "?"} ` +
        `overall=${d?.overall ?? "?"}`,
    );
    kioskEventBus.emit("kiosk_self_test", { ...d, ts: Date.now() });
  });

  // -- The kiosk's own calibrated timings (2026-09-17). Read-only on this
  // side: stored so the admin console can show what the hardware really uses
  // (D-83) and the phone's door countdown can use the real per-bay seconds
  // (D-82). Nothing here is ever pushed back to the Pi.
  socket.on("kiosk:timing_report", (data: { kiosk_id?: string; lockers?: unknown }) => {
    if (!isKiosk(socket)) return;
    const kioskId = String(data?.kiosk_id ?? socket.data.kioskId ?? "");
    if (!kioskId) return;
    const report = recordTimingReport(kioskId, data?.lockers);
    if (!report) {
      logger.warn(`[PI-TIMING] ${kioskId} sent a timing report with no valid bays -- ignored`);
      return;
    }
    logger.info(
      `[PI-TIMING] ${kioskId} reported ` +
        Object.entries(report.lockers)
          .map(([bay, t]) => `bay ${bay} main ${t.main_door_open_seconds}s/bottom ${t.bottom_door_open_seconds}s/ext ${t.actuator_extend_seconds}s/ret ${t.actuator_retract_seconds}s`)
          .join("; "),
    );
  });

  // ── Pi log forwarding — all relevant Pi logs streamed to Render
  socket.on(
    "kiosk:log",
    (data: {
      kiosk_id: string;
      level: string;
      module: string;
      message: string;
      ts: number;
    }) => {
      if (!isKiosk(socket)) return;
      const { kiosk_id, level, module, message } = data;
      const tag =
        level === "WARNING" || level === "ERROR" || level === "CRITICAL"
          ? `⚠️  [PI-${level}]`
          : `📟 [PI-LOG]`;
      const line = `${tag}  ${kiosk_id} | ${level.padEnd(8)} | ${module.padEnd(20)} | ${message}`;
      if (level === "ERROR" || level === "CRITICAL") {
        logger.error(line);
      } else if (level === "WARNING") {
        logger.warn(line);
      } else {
        logger.info(line);
      }
      const logLine = { ...data, ts: Date.now() };
      // Kept so the admin console can open with history. The stream below only
      // carries what happens while a page is watching, and an idle kiosk logs
      // nothing for minutes — which is why the panel read "Waiting for Pi
      // logs…" and looked broken.
      recordKioskLog(logLine);
      kioskEventBus.emit("kiosk_log", logLine);
    },
  );

  // ── App-initiated kiosk scan — Flutter app scanned kiosk QR then tapped action
  // Token format: "{kiosk_id}:{token_id}:{ts}:{sig}" — first segment is the kiosk ID.
  // Node forwards the token + rental context to that kiosk for local validation.
  socket.on(
    "app:kiosk_scan",
    (data: {
      token: string;
      rentalId: string;
      mode: "place" | "retrieve" | "return";
      userId: string;
    }) => {
      if (!isUser(socket)) {
        logger.warn("Rejected 'app:kiosk_scan' from non-authenticated socket");
        return;
      }
      const { token, rentalId, mode } = data ?? {};
      // Trust the authenticated identity, not a client-supplied userId
      const userId = socket.data.userId as string;

      if (!token || !rentalId) {
        socket.emit("kiosk:scan_error", {
          rentalId,
          message: "Missing required fields",
        });
        return;
      }

      // Parse kiosk_id from the first colon-delimited segment of the token
      const kioskId = token.split(":")[0];
      if (!kioskId) {
        socket.emit("kiosk:scan_error", {
          rentalId,
          message: "Invalid QR token — could not identify kiosk",
        });
        return;
      }

      logger.info(
        `\n┌─────────────────────────────────────────────\n` +
          `│  📱 [APP-SCAN]  User scanned kiosk QR\n` +
          `│  User    : ${userId}\n` +
          `│  Kiosk   : ${kioskId}\n` +
          `│  Rental  : ${rentalId}\n` +
          `│  Mode    : ${mode}\n` +
          `└─────────────────────────────────────────────`,
      );

      // Forward to the kiosk — it validates the token and starts the rental flow
      io.to(`kiosk:${kioskId}`).emit("kiosk:session_validate", {
        token,
        rentalId,
        mode,
        userId,
      });
    },
  );

  // ── Kiosk relays a token-validation failure back — forward to the user's room
  socket.on(
    "kiosk:scan_error_relay",
    (data: { userId: string; rentalId: string; message: string }) => {
      if (!isKiosk(socket)) return;
      const { userId, rentalId, message } = data ?? {};
      if (userId) {
        io.to(`user:${userId}`).emit("kiosk:scan_error", {
          rentalId,
          message,
          // The relaying socket IS the kiosk that rejected the token, so
          // this is the one scan_error case where a real kiosk ID exists —
          // the other two happen before a kiosk is ever identified.
          kioskId: socket.data.kioskId as string | undefined,
        });
        logger.warn(`[KIOSK-SCAN]  Token validation failed for user ${userId}: ${message}`);
      }
    },
  );

  socket.on("disconnect", () => {
    logger.info(
      `\n┌─────────────────────────────────────────────\n` +
        `│  🔴 [PI-OFFLINE]  Kiosk disconnected\n` +
        `│  Socket : ${socket.id}\n` +
        `└─────────────────────────────────────────────`,
    );
    kioskEventBus.emit("kiosk_offline", {
      socket_id: socket.id,
      ts: Date.now(),
    });
  });
});

// ── Late fee cron — runs daily at 01:00 server time ───────────────────────
// Per-category daily rates, derived from docs/reference/ITEM_CATEGORIES.md's
// "Pricing Guidelines" table (§ Suggested Daily Rental Rates), averaged
// within each Prisma ItemCategory bucket. Two judgment calls worth recording:
//   1. That table's column is literally labeled "Late Fee/Hour", but its
//      values (₱5-₱80) only make sense read as *daily* rates — at face value
//      an hourly rate would integrate to ₱120-₱1,920/day, several times the
//      item's own daily rental price. Treating the header as the doc's own
//      error and the values as per-day is consistent with this rate's own
//      prior placeholder comment, written the same way before this fix.
//   2. SPORTS_EQUIPMENT and OTHER have no row in that table at all — rather
//      than inventing a number with zero basis, both fall back to the old
//      flat ₱50/day (still a documented default, not silently different).
const LATE_FEE_RATE_BY_CATEGORY: Record<string, number> = {
  SCHOOL_ATTIRE: 12, // avg of Lab Gown ₱10, School Uniform ₱15, PE Uniform ₱10
  ACADEMIC_TOOLS: 15, // avg of Calculator ₱10, Drawing Tools ₱20
  ELECTRONICS: 28, // avg of Laptop ₱50, Tablet ₱30, Power Bank ₱5
  DEVELOPMENT_KITS: 20, // avg of Arduino Kit ₱15, Raspberry Pi Kit ₱25
  MEASUREMENT_TOOLS: 10, // Multimeter ₱10 (only category row with a documented rate)
  AUDIO_VISUAL: 45, // avg of Headphones ₱10, Camera ₱80
};
const DEFAULT_LATE_FEE_RATE_PER_DAY = 50; // SPORTS_EQUIPMENT, OTHER — no doc data

/**
 * E4.6 / R1 — release items the renter never collected.
 *
 * Runs HOURLY, not daily like the late-fee job, because the grace period is
 * configurable down to an hour and a daily tick would make a 1-hour setting
 * mean "some time tomorrow". The policy itself decides whether each candidate
 * may actually move — including the admin-configured release window, so this
 * firing at 03:00 does not mean anything drops at 03:00.
 */
cron.schedule("5 * * * *", async () => {
  try {
    const { considered, released, cancelled } = await runCollectionSweep(io);
    const fixed = await reconcileItemAvailability();
    if (fixed > 0) logger.info(`[AVAILABILITY] ${fixed} item(s) had the wrong availability — corrected by the sweep`);
    if (considered === 0) return;
    logger.info(
      `[CRON] E4.6 collection sweep — ${considered} uncollected deposit(s) considered, ` +
        `${released} released, ${cancelled} auto-cancelled`,
    );
  } catch (err) {
    logger.error(`[CRON] E4.6 collection sweep failed: ${(err as Error).message}`);
  }
});

// E6.S — items handed back to their owner who has not come for them. The user's
// ruling (2026-09-24): the upper compartment must be free for the next deposit,
// so an item left up there past the grace is dropped to the lower one, and a
// bay is only blocked when BOTH compartments hold something. Every judgement
// (grace, window, bay busy, lower compartment free) lives in
// dropUncollectedToLower; this loop only finds candidates. Its own slot, ten
// minutes after the sweep above, so the two never stroke in the same tick.
cron.schedule("15 * * * *", async () => {
  try {
    // E6.T / D-108 — an owner who collected while the database dropped can be
    // left retrieved-but-not-COMPLETED; finish it here. Idempotent: completion
    // only acts on VERIFICATION + APPROVED + OWNER_RETURN_PICKUP.
    const collected = await prisma.rental.findMany({
      where: {
        status: "VERIFICATION",
        verificationStatus: "APPROVED",
        releaseReason: "OWNER_RETURN_PICKUP",
        retrievedAt: { not: null },
      },
      select: { id: true },
    });
    for (const rental of collected) {
      if (await completeAfterOwnerPickup(io, rental.id)) {
        logger.warn(`[D-108] rental ${rental.id} completed by the sweep: its pickup reply had failed`);
      }
    }

    const waiting = await prisma.rental.findMany({
      where: { releasedAt: { not: null }, retrievedAt: null },
      select: { id: true },
    });
    if (waiting.length === 0) return;
    let dropped = 0;
    for (const rental of waiting) {
      const outcome = await dropUncollectedToLower(io, rental.id);
      if (outcome.released) dropped += 1;
      else logger.info(`[E6.S] not dropping rental ${rental.id}: ${outcome.refusal}`);
    }
    logger.info(
      `[CRON] E6.S uncollected-by-owner sweep — ${waiting.length} waiting, ${dropped} dropped`,
    );
  } catch (err) {
    logger.error(`[CRON] E6.S uncollected-by-owner sweep failed: ${(err as Error).message}`);
  }
});

// D-91 — the sibling gap: rentals that never even reached a deposit, past
// their own end date. Nothing physical to move here (no locker, no
// actuator), so unlike the sweep above this is pure database bookkeeping.
// Same hourly cadence, offset five minutes so the two do not hit the
// database in the same tick.
cron.schedule("10 * * * *", async () => {
  try {
    const { considered, cancelled } = await cancelOverdueUndepositedRentals();
    if (considered > 0) {
      logger.info(
        `[CRON] D-91 overdue-undeposited sweep — ${considered} considered, ${cancelled} cancelled`,
      );
    }
  } catch (err) {
    logger.error(`[CRON] D-91 overdue-undeposited sweep failed: ${(err as Error).message}`);
  }
});

cron.schedule("0 1 * * *", async () => {
  logger.info("[CRON] Running late fee check…");
  try {
    const overdueRentals = await prisma.rental.findMany({
      where: {
        status: "ACTIVE",
        endDate: { lt: new Date() },
      },
      include: {
        renter: { select: { id: true, email: true, firstName: true } },
        item: { select: { title: true, category: true } },
        transactions: { where: { type: "LATE_FEE", status: "COMPLETED" } },
      },
    });

    for (const rental of overdueRentals) {
      const now = new Date();
      const daysLate = Math.floor(
        (now.getTime() - rental.endDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (daysLate <= 0) continue;

      // Only charge days not yet billed
      const alreadyBilled = rental.transactions.length;
      const daysToBill = daysLate - alreadyBilled;
      if (daysToBill <= 0) continue;

      const rate =
        LATE_FEE_RATE_BY_CATEGORY[rental.item.category] ??
        DEFAULT_LATE_FEE_RATE_PER_DAY;
      const lateFee = daysToBill * rate;

      await prisma.$transaction([
        prisma.transaction.create({
          data: {
            rentalId: rental.id,
            userId: rental.renterId,
            type: "LATE_FEE",
            amount: lateFee,
            status: "COMPLETED",
            paidAt: now,
            // No real charge happens here — this is a claim against the
            // renter's held security deposit, settled (deducted from the
            // deposit refund) once the rental completes. See
            // rentalSettlementService.ts's finalizeRentalCompletion().
            paymentMethod: "Held Deposit Deduction",
          },
        }),
        prisma.notification.create({
          data: {
            userId: rental.renterId,
            title: "Late Return Fee Applied",
            message: `A late fee of ₱${lateFee.toFixed(2)} has been applied for ${rental.item.title} (${daysToBill} day(s) overdue). This will be deducted from your security deposit refund.`,
            type: "RETURN_OVERDUE",
            relatedEntityId: rental.id,
            relatedEntityType: "rental",
          },
        }),
      ]);

      await sendReturnOverdue(rental.renter.email, {
        firstName: rental.renter.firstName,
        itemTitle: rental.item.title,
        dueDate: rental.endDate.toLocaleDateString("en-PH"),
        daysLate,
        lateFee,
        rentalId: rental.id,
      });

      logger.info(
        `[CRON] Late fee ₱${lateFee} applied for rental ${rental.id} (${daysLate} days late)`,
      );
    }

    logger.info(
      `[CRON] Late fee check done — ${overdueRentals.length} overdue rental(s) checked`,
    );
  } catch (err) {
    logger.error("[CRON] Late fee check failed:", err);
  }
});

// ── Server startup ─────────────────────────────────────────────────────────
const PORT = parseInt(env.PORT);

const startServer = async (): Promise<void> => {
  try {
    await connectDatabase();

    // Repairs listings a cancel path left marked unavailable (2026-09-25).
    reconcileItemAvailability()
      .then((n) => n > 0 && logger.info(`[AVAILABILITY] ${n} item(s) had the wrong availability — corrected at startup`))
      .catch((err) => logger.error("[AVAILABILITY] startup reconcile failed:", err));

    // Starts recording kiosk events into the rolling in-memory buffer a
    // KIOSK_PROBLEM feedback report can later snapshot (see utils/
    // kioskEventLog.ts). Must run before any kiosk socket connects, so it's
    // installed at startup rather than lazily on first use.
    installKioskEventLog();

    httpServer.listen(PORT, "0.0.0.0", () => {
      logger.info(`
╔════════════════════════════════════════════╗
║   🚀 EngiRent Hub API Server Started      ║
║   Port: ${PORT}  |  Env: ${env.NODE_ENV.padEnd(12)}      ║
║   API: http://localhost:${PORT}/api/${env.API_VERSION}     ║
╚════════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
};

// D-102 (2026-09-24): Node's default for an unhandled rejection is to kill the
// process, and nothing on the server restarts this API by itself (the
// Scheduled Task does not relaunch it). One ~seconds-long database blip on
// 2026-09-24 took the whole API down until a human noticed. Any async socket
// handler or cron job that lets a rejection escape would do the same. Log it
// loudly and keep serving. Every other request, and the kiosk socket, is
// unaffected by one failed operation.
process.on("unhandledRejection", (reason) => {
  logger.error("[D-102] Unhandled promise rejection — process kept alive:", reason);
});

process.on("SIGTERM", () => {
  logger.info("SIGTERM received — closing server");
  httpServer.close(() => logger.info("HTTP server closed"));
});

startServer();

export { app, io };
