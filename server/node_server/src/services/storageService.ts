import axios, { AxiosError } from "axios";
import env from "../config/env";

// Strip any path suffix — only the origin is needed for REST API calls
const supabaseOrigin = env.SUPABASE_URL.replace(
  /\/(rest|storage|auth|realtime)(\/.*)?$/,
  "",
);
const BUCKET = env.SUPABASE_STORAGE_BUCKET;

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
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
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
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
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
