import { Router } from "express";
import env from "../config/env";
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
router.get("/app-config", (_req, res) => {
  res.json({
    success: true,
    data: {
      minVersion: env.MIN_APP_VERSION,
      latestVersion: env.LATEST_APP_VERSION,
      forceUpdateMessage: env.FORCE_UPDATE_MESSAGE,
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
