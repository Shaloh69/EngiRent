import { createClient } from "@supabase/supabase-js";
import env from "../config/env";

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

/** Single bucket — use folder prefixes to organise files */
const BUCKET = env.SUPABASE_STORAGE_BUCKET; // "media"

export const FOLDERS = {
  ITEMS: "item-images",
  KIOSK: "kiosk-captures",
  PROFILES: "profile-images",
} as const;

/**
 * Upload a file buffer to Supabase Storage.
 * @param folder  One of FOLDERS.* (used as a path prefix inside the bucket)
 * @param filename Unique filename including extension
 * @param buffer  File data
 * @param mimetype Content-Type
 * @returns Public URL of the uploaded file
 */
export async function uploadFile(
  folder: string,
  filename: string,
  buffer: Buffer,
  mimetype: string,
): Promise<string> {
  const path = `${folder}/${filename}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: mimetype, upsert: true });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Delete a file from Supabase Storage by its storage path (folder/filename).
 */
export async function deleteFile(storagePath: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);
  if (error) throw new Error(`Storage delete failed: ${error.message}`);
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
