import axios, { AxiosError } from "axios";
import env from "../config/env";

// Strip any path suffix — only the origin is needed for REST API calls
const supabaseOrigin = env.SUPABASE_URL.replace(
  /\/(rest|storage|auth|realtime)(\/.*)?$/,
  "",
);
const BUCKET = env.SUPABASE_STORAGE_BUCKET;

// Trim whitespace that may have been copied into the env var.
// A trailing newline makes the JWT unrecognisable by PostgREST, causing
// "new row violates row-level security policy" instead of an auth error.
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY.trim();

// Startup diagnostic: decode the JWT payload (middle segment) and log the role
// claim so we can verify the correct key is configured — no secret is logged.
(function _logKeyRole() {
  try {
    const parts = SERVICE_KEY.split(".");
    if (parts.length === 3) {
      const payload = JSON.parse(
        Buffer.from(parts[1], "base64url").toString("utf8"),
      );
      const role: string = payload?.role ?? "unknown";
      const ref: string = payload?.ref ?? "unknown";
      console.info(
        `[storage] Supabase key: project=${ref} role=${role} ` +
          `(expected role=service_role)`,
      );
      if (role !== "service_role") {
        console.error(
          "[storage] WRONG KEY — SUPABASE_SERVICE_ROLE_KEY has role=" +
            role +
            ". Replace it with the service_role key from the Supabase dashboard.",
        );
      }
    } else {
      // New-format sb_secret_... key — not a JWT, both headers are still sent correctly
      console.info("[storage] Supabase key: non-JWT format (sb_secret_...)");
    }
  } catch {
    console.warn("[storage] Could not decode SUPABASE_SERVICE_ROLE_KEY payload");
  }
})();

export const FOLDERS = {
  ITEMS: "item-images",
  KIOSK: "kiosk-captures",
  PROFILES: "profile-images",
} as const;

/**
 * Upload a file buffer directly via Supabase Storage REST API.
 * Using axios bypasses the supabase-js client entirely — the service_role
 * bearer token on the Authorization header is sufficient and avoids RLS.
 */
export async function uploadFile(
  folder: string,
  filename: string,
  buffer: Buffer,
  mimetype: string,
): Promise<string> {
  const filePath = `${folder}/${filename}`;
  const uploadUrl = `${supabaseOrigin}/storage/v1/object/${BUCKET}/${filePath}`;

  try {
    await axios.post(uploadUrl, buffer, {
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
        "Content-Type": mimetype,
        "x-upsert": "true",
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
  } catch (err) {
    const detail =
      err instanceof AxiosError
        ? JSON.stringify(err.response?.data)
        : String(err);
    throw new Error(
      `Storage upload failed: ${detail} (bucket=${BUCKET} path=${filePath} url=${supabaseOrigin})`,
    );
  }

  return `${supabaseOrigin}/storage/v1/object/public/${BUCKET}/${filePath}`;
}

/**
 * Delete a file from Supabase Storage by its storage path (folder/filename).
 */
export async function deleteFile(storagePath: string): Promise<void> {
  const deleteUrl = `${supabaseOrigin}/storage/v1/object/${BUCKET}`;
  try {
    await axios.delete(deleteUrl, {
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
        "Content-Type": "application/json",
      },
      data: { prefixes: [storagePath] },
    });
  } catch (err) {
    const detail =
      err instanceof AxiosError
        ? JSON.stringify(err.response?.data)
        : String(err);
    throw new Error(`Storage delete failed: ${detail}`);
  }
}

/**
 * Extract the storage path (folder/filename) from a full Supabase public URL.
 */
export function pathFromUrl(url: string): string {
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return url;
  return url.slice(idx + marker.length);
}
