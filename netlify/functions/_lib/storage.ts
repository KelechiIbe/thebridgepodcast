import { adminClient, BUCKET } from "./supabase";
import { HttpError } from "./http";

export async function download(path: string): Promise<Blob> {
  const { data, error } = await adminClient().storage.from(BUCKET).download(path);
  if (error || !data) throw new HttpError(404, `Couldn't read ${path} from storage.`);
  return data;
}

export async function upload(path: string, bytes: Uint8Array | Blob, contentType: string) {
  const { error } = await adminClient().storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) throw new HttpError(500, `Couldn't save ${path}: ${error.message}`);
  return path;
}
