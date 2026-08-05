import crypto from "crypto";
import env from "../config/env";

// AES-256-GCM field-level encryption for sensitive JSON data (currently:
// User.faceEncoding, a 128-float biometric template). GCM gives us both
// confidentiality and integrity (a tampered ciphertext fails to decrypt)
// without a separate MAC step.
//
// The AES key is derived once, deterministically, from BIOMETRIC_ENCRYPTION_KEY
// via SHA-256 — this lets the env var be any sufficiently long random string
// rather than requiring an exact 32-byte hex/base64 value.

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV is the recommended size for GCM

let cachedKey: Buffer | null = null;
function getKey(): Buffer {
  if (!cachedKey) {
    cachedKey = crypto
      .createHash("sha256")
      .update(env.BIOMETRIC_ENCRYPTION_KEY)
      .digest();
  }
  return cachedKey;
}

export interface EncryptedBlob {
  /** Marks this JSON value as ciphertext rather than plaintext, so a reader
   *  can tell the two apart without guessing from shape alone. */
  __enc: "aes-256-gcm";
  iv: string; // base64
  authTag: string; // base64
  data: string; // base64 ciphertext
}

/** Encrypts any JSON-serializable value into a blob safe to store in a `Json` column. */
export function encryptJson(value: unknown): EncryptedBlob {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    __enc: "aes-256-gcm",
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    data: encrypted.toString("base64"),
  };
}

/** True when a stored value is one of our encrypted blobs (vs. legacy plaintext). */
export function isEncryptedBlob(value: unknown): value is EncryptedBlob {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).__enc === "aes-256-gcm" &&
    typeof (value as Record<string, unknown>).iv === "string" &&
    typeof (value as Record<string, unknown>).authTag === "string" &&
    typeof (value as Record<string, unknown>).data === "string"
  );
}

/** Decrypts a blob produced by {@link encryptJson}. Throws if the key is wrong
 *  or the ciphertext/tag has been tampered with. */
export function decryptJson<T = unknown>(blob: EncryptedBlob): T {
  const iv = Buffer.from(blob.iv, "base64");
  const authTag = Buffer.from(blob.authTag, "base64");
  const data = Buffer.from(blob.data, "base64");

  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8")) as T;
}

/**
 * Decrypts a `User.faceEncoding` value, tolerating legacy unencrypted rows
 * (a raw 128-float array written before this encryption was introduced).
 * Returns null for anything that isn't a usable encoding.
 */
export function decryptFaceEncoding(stored: unknown): number[] | null {
  if (stored == null) return null;
  if (isEncryptedBlob(stored)) {
    try {
      const value = decryptJson<number[]>(stored);
      return Array.isArray(value) && value.length === 128 ? value : null;
    } catch {
      return null;
    }
  }
  // Legacy plaintext row from before encryption was added.
  return Array.isArray(stored) && stored.length === 128
    ? (stored as number[])
    : null;
}
