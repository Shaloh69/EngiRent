import { Router } from "express";
import env from "../config/env";
import prisma from "../config/database";
import authRoutes from "./authRoutes";
import itemRoutes from "./itemRoutes";
import rentalRoutes from "./rentalRoutes";
import paymentRoutes from "./paymentRoutes";
import kioskRoutes from "./kioskRoutes";
import notificationRoutes from "./notificationRoutes";
import uploadRoutes from "./uploadRoutes";
import adminRoutes from "./adminRoutes";
import reviewRoutes from "./reviewRoutes";
import feedbackRoutes from "./feedbackRoutes";

const router = Router();

// Health check
router.get("/health", (_req, res) => {
  res.json({
    success: true,
    message: "EngiRent API is running",
    timestamp: new Date().toISOString(),
  });
});

// Checklist Stage 9 — force-update gate. Public (no auth — an app too old
// to know its own status yet still needs to reach this), read-only.
//
// Follow-up (2026-08-10) — the Update Required screen needs real content,
// not just a version number: what's actually new, and — a specific,
// explicit ask — crediting the real student who reported a bug that got
// fixed in this build. Both come from real rows (AppRelease.highlights,
// Feedback.fixedInVersion), never invented here.
router.get("/app-config", async (_req, res) => {
  const release = await prisma.appRelease.findUnique({
    where: { version: env.LATEST_APP_VERSION },
  });

  const fixedFeedback = await prisma.feedback.findMany({
    where: { fixedInVersion: env.LATEST_APP_VERSION, status: "RESOLVED" },
    select: {
      id: true,
      category: true,
      body: true,
      user: { select: { firstName: true, lastName: true } },
    },
    orderBy: { resolvedAt: "asc" },
  });

  res.json({
    success: true,
    data: {
      minVersion: env.MIN_APP_VERSION,
      latestVersion: env.LATEST_APP_VERSION,
      forceUpdateMessage: env.FORCE_UPDATE_MESSAGE,
      // Where the Update Required screen's button actually goes. EngiRent
      // has no Play Store listing — pointing there was a dead placeholder.
      // The web download flow (real fetch progress, thank-you page) is the
      // actual, working distribution path.
      downloadUrl: `${env.CLIENT_WEB_URL}/downloading`,
      highlights: (release?.highlights as string[] | undefined) ?? [],
      // First name + last initial only — same privacy bar as everywhere
      // else a student's name surfaces outside their own account (e.g.
      // reviews), not a full name or any contact detail.
      creditedFixes: fixedFeedback.map((f) => ({
        reporterName: `${f.user.firstName} ${f.user.lastName.charAt(0)}.`,
        summary: f.body.length > 140 ? `${f.body.slice(0, 140)}…` : f.body,
      })),
    },
  });
});

// API routes
router.use("/auth", authRoutes);
router.use("/items", itemRoutes);
router.use("/rentals", rentalRoutes);
router.use("/payments", paymentRoutes);
router.use("/kiosk", kioskRoutes);
router.use("/notifications", notificationRoutes);
router.use("/upload", uploadRoutes);
router.use("/admin", adminRoutes);
router.use("/reviews", reviewRoutes);
router.use("/feedback", feedbackRoutes);

export default router;
