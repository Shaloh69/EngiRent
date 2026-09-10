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
import routes from "./routes";
import mediaRoutes from "./routes/mediaRoutes";
import { errorHandler, notFound } from "./middleware/errorHandler";
import { rateLimiter } from "./middleware/rateLimiter";
import { mediaUrlRewriter } from "./middleware/mediaUrlRewriter";
import prisma from "./config/database";
import kioskEventBus from "./utils/kioskEventBus";
import { installKioskEventLog } from "./utils/kioskEventLog";
import { recomputeItemAvailability } from "./services/itemAvailabilityService";
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
import { resolveFaceSubject } from "./services/faceVerificationService";
import { runMlVerification } from "./services/mlVerificationService";
import { openKioskSession } from "./services/kioskSessionStore";
import { finalizeRentalCompletion } from "./services/rentalSettlementService";
import {
  sendItemReadyForClaim,
  sendRentalCompleted,
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

// ── Auto-complete a rental after successful verifications ────────────────────
async function completeRental(rentalId: string): Promise<void> {
  const rental = await prisma.rental.findUnique({
    where: { id: rentalId },
    include: {
      item: true,
      renter: { select: { firstName: true, email: true } },
      owner: { select: { firstName: true, email: true } },
    },
  });
  if (!rental) return;

  await prisma.$transaction([
    prisma.rental.update({
      where: { id: rentalId },
      data: { status: "COMPLETED", completedAt: new Date() },
    }),
    prisma.item.update({
      where: { id: rental.itemId },
      data: { isAvailable: true, totalRentals: { increment: 1 } },
    }),
    prisma.notification.create({
      data: {
        userId: rental.renterId,
        title: "Rental Completed",
        message: `Your rental of ${rental.item.title} is complete. Security deposit refund is being processed.`,
        type: "VERIFICATION_SUCCESS",
        relatedEntityId: rentalId,
        relatedEntityType: "rental",
      },
    }),
    prisma.notification.create({
      data: {
        userId: rental.ownerId,
        title: "Item Returned & Verified",
        message: `${rental.item.title} has been returned and verified. Rental payment will be released.`,
        type: "VERIFICATION_SUCCESS",
        relatedEntityId: rentalId,
        relatedEntityType: "rental",
      },
    }),
  ]);

  // Checklist Stage 6 — see itemAvailabilityService's doc comment: the
  // transaction above sets isAvailable: true unconditionally; this corrects
  // it if a different, non-overlapping rental on the same item already
  // covers today (only possible now that an item can have more than one
  // booking over time).
  await recomputeItemAvailability(rental.itemId);

  // Email both parties
  await Promise.all([
    sendRentalCompleted(rental.renter.email, {
      firstName: rental.renter.firstName,
      itemTitle: rental.item.title,
      rentalId,
    }),
    sendRentalCompleted(rental.owner.email, {
      firstName: rental.owner.firstName,
      itemTitle: rental.item.title,
      rentalId,
    }),
  ]);

  // Real money movement: refund the renter's deposit (minus any damage/late
  // fees already logged) and pay the owner out — see rentalSettlementService.ts.
  // Deliberately outside the $transaction above — each half calls an external
  // PayMongo API and creates its own follow-up notification independently.
  await finalizeRentalCompletion(rentalId);

  // Notify both parties via socket
  io.to(`user:${rental.renterId}`).emit("rental:completed", { rentalId });
  io.to(`user:${rental.ownerId}`).emit("rental:completed", { rentalId });
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
      status: "ok" | "error";
      message?: string;
    }) => {
      if (!isKiosk(socket)) return;
      const { kiosk_id, command_id, action, status, message } = data;
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

          try {
            mlResult = await runMlVerification(
              rental.item.images as string[],
              image_urls,
              attemptNumber,
              rental.item.mlFeatures,
            );
          } catch (err) {
            mlError = (err as Error).message;
            mlResult = {
              decision: "PENDING",
              confidence: 0,
              method_scores: {},
              ocr: null,
            };
          }

          const { decision, confidence, method_scores } = mlResult;

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
            if (locker) {
              await prisma.locker.update({
                where: { id: locker.id },
                data: { status: "AVAILABLE", currentRentalId: null },
              });
              // D-53: the bay just went back to AVAILABLE. Tell the kiosk.
              await emitLockerOccupancy(io, locker.kioskId);
            }
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
              ...(mlError && { reviewNotes: `ML error: ${mlError}` }),
            },
          });

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
            await prisma.locker.update({
              where: { id: locker.id },
              data: {
                status: "OCCUPIED",
                currentRentalId: rental_id,
                lastUsedAt: new Date(),
              },
            });
            // D-53: deposit accepted — the bay now holds an item.
            await emitLockerOccupancy(io, locker.kioskId);
          }

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
            mlResult = {
              decision: "PENDING",
              confidence: 0,
              method_scores: {},
              ocr: null,
            };
          }

          const { decision, confidence, method_scores } = mlResult;

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
            if (locker) {
              await prisma.locker.update({
                where: { id: locker.id },
                data: { status: "AVAILABLE", currentRentalId: null },
              });
              // D-53: disputed return still frees the bay.
              await emitLockerOccupancy(io, locker.kioskId);
            }
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
              ...(mlError && { reviewNotes: `ML error: ${mlError}` }),
            },
          });

          const verificationStatus =
            decision === "APPROVED" ? "APPROVED" : "MANUAL_REVIEW";

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
            await prisma.locker.update({
              where: { id: locker.id },
              data: {
                status: "OCCUPIED",
                currentRentalId: rental_id,
                lastUsedAt: new Date(),
              },
            });
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
            await prisma.locker.update({
              where: { id: rental.depositLockerId },
              data: { status: "AVAILABLE", currentRentalId: null },
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

        const validStatuses = ["AWAITING_DEPOSIT", "DEPOSITED", "ACTIVE"];
        if (!validStatuses.includes(rental.status)) {
          socket.emit("kiosk:command", {
            action: "flow_error",
            message: `Rental status "${rental.status}" is not actionable at kiosk`,
          });
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
        openKioskSession(rental_id, data.kiosk_id, subject.userId);

        io.to(`user:${subject.userId}`).emit("kiosk:face_required", {
          rentalId: rental_id,
          kioskId: data.kiosk_id,
          action:
            rental.status === "AWAITING_DEPOSIT"
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
      kioskEventBus.emit("kiosk_log", { ...data, ts: Date.now() });
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

process.on("SIGTERM", () => {
  logger.info("SIGTERM received — closing server");
  httpServer.close(() => logger.info("HTTP server closed"));
});

startServer();

export { app, io };
