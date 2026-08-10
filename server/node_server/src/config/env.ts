import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  // Server
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.string().default("5000"),
  API_VERSION: z.string().default("v1"),

  // Database
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // JWT
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRE: z.string().default("7d"),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),
  JWT_REFRESH_EXPIRE: z.string().default("30d"),

  // ML Service
  ML_SERVICE_URL: z.string().url().default("http://localhost:8001"),
  ML_SERVICE_API_KEY: z.string().optional(),

  // PayMongo
  PAYMONGO_SECRET_KEY: z.string().optional(),
  PAYMONGO_PUBLIC_KEY: z.string().optional(),
  PAYMONGO_WEBHOOK_SECRET: z.string().optional(),
  // Disbursements (Transfers V2) — the platform's own PayMongo Wallet, i.e.
  // the `source_account` every outbound owner-payout Transfer moves money
  // from. Optional: if unset, source_account is omitted from the request
  // entirely (PayMongo's docs suggest this defaults to the account's own
  // wallet, but this is unconfirmed from docs alone — verify against the
  // real sandbox response in Phase 4's live audit before trusting it blind).
  PAYMONGO_SOURCE_ACCOUNT_NUMBER: z.string().optional(),
  PAYMONGO_SOURCE_ACCOUNT_NAME: z.string().optional(),
  PAYMONGO_SOURCE_ACCOUNT_BIC: z.string().optional(),

  // Local file storage (Phase 0.5 — replaces Supabase Storage entirely).
  // Directory structure and access-tier rules are documented in
  // src/services/storageService.ts.
  STORAGE_DIR: z.string().default("./storage"),
  // This service's own externally-reachable origin, used to build absolute
  // media URLs (item photos, signed biometric/verification links) returned
  // in API responses. Update this once the API's real address changes (e.g.
  // moving off Render onto the self-hosted PC's Tailscale address).
  API_PUBLIC_URL: z.string().url().default("http://localhost:5000"),
  // Secret used to HMAC-sign short-lived tokens for private media (ID
  // photos, kiosk verification images) — see signMediaPath()/verifyMediaToken()
  // in storageService.ts. Reuses the same derivation approach as
  // BIOMETRIC_ENCRYPTION_KEY (SHA-256 of any sufficiently long secret).
  MEDIA_SIGNING_KEY: z
    .string()
    .min(32, "MEDIA_SIGNING_KEY must be at least 32 characters"),
  MEDIA_SIGNED_URL_TTL_SECONDS: z.string().default("3600"),

  // Biometric data encryption
  // Encrypts User.faceEncoding at rest (AES-256-GCM, see utils/crypto.ts).
  // Required — biometric data must never be written unencrypted. The raw
  // secret is hashed (SHA-256) to derive a deterministic 32-byte AES key, so
  // any sufficiently long random string works, not just an exact-length
  // hex/base64 value. Generate one with: openssl rand -base64 48
  BIOMETRIC_ENCRYPTION_KEY: z
    .string()
    .min(32, "BIOMETRIC_ENCRYPTION_KEY must be at least 32 characters"),

  // Frontend URLs
  CLIENT_WEB_URL: z.string().url().default("http://localhost:3000"),
  CLIENT_MOBILE_URL: z.string().url().default("http://localhost:3000"),
  CLIENT_ADMIN_URL: z.string().url().default("http://localhost:3001"),

  // Kiosk
  // Shared secret the Raspberry Pi presents on the Socket.io handshake so the
  // backend can prove a socket is a genuine kiosk before honouring any
  // lock/verification event. If unset, kiosk hardware events are refused
  // (fail-closed) — see the io.use() auth middleware in index.ts.
  KIOSK_SHARED_SECRET: z.string().min(16).optional(),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.string().default("900000"),
  RATE_LIMIT_MAX_REQUESTS: z.string().default("100"),

  // File Upload — actually enforced by middleware/upload.ts (previously
  // declared here but silently ignored; that middleware hardcoded its own
  // values instead). The default list includes video/mp4 and
  // application/octet-stream because Android camera packages often send the
  // latter for what is actually a JPEG — narrowing this without matching
  // client-side behavior would break mobile-app photo uploads.
  MAX_FILE_SIZE: z.string().default("10485760"),
  ALLOWED_FILE_TYPES: z
    .string()
    .default(
      "image/jpeg,image/jpg,image/png,image/webp,video/mp4,application/octet-stream",
    ),

  // Logging
  LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info"),

  // Email (optional — notifications disabled when absent)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().default("587"),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  // Admin seed (optional — used once on first deploy)
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  ADMIN_STUDENT_ID: z.string().optional(),

  // Checklist Stage 9 — force-update gate. Compared against the app's real
  // version (PackageInfo, already wired for display in Profile) via
  // GET /app-config. No enforcement mechanism existed before this at all —
  // config only, deliberately not a DB table, since this changes rarely and
  // shouldn't need a migration to update.
  MIN_APP_VERSION: z.string().default("1.0.0"),
  LATEST_APP_VERSION: z.string().default("1.5.2"),
  FORCE_UPDATE_MESSAGE: z
    .string()
    .default("Please update EngiRent to continue — this version is no longer supported."),
});

type EnvConfig = z.infer<typeof envSchema>;

let env: EnvConfig;

try {
  env = envSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error("❌ Invalid environment variables:");
    error.errors.forEach((err) => {
      console.error(`  - ${err.path.join(".")}: ${err.message}`);
    });
    process.exit(1);
  }
  throw error;
}

export default env;
