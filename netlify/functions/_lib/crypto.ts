import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env, HttpError } from "./http";

function key(): Buffer {
  const secret = env("APP_SECRET");
  if (!secret || secret.length < 24) throw new HttpError(500, "APP_SECRET must be set on the server (24+ random characters) to store API keys.");
  return createHash("sha256").update(secret).digest();
}

export function encrypt(plain: string): { ciphertext: string; iv: string } {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final(), c.getAuthTag()]);
  return { ciphertext: enc.toString("base64"), iv: iv.toString("base64") };
}

export function decrypt(ciphertext: string, iv: string): string {
  const buf = Buffer.from(ciphertext, "base64");
  const tag = buf.subarray(buf.length - 16);
  const data = buf.subarray(0, buf.length - 16);
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}
