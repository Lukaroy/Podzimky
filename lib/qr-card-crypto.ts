import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Klíč se odvozuje z existujícího serverového secretu, aby nebylo nutné přidávat novou proměnnou prostředí.
function getKey() {
  const secret = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.trim();
  if (!secret) throw new Error("Chybí serverový secret pro šifrování QR kartiček.");
  return createHash("sha256").update(`team-qr-card:${secret}`).digest();
}

export function encryptQrToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const data = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString("base64url")).join(".");
}

export function decryptQrToken(payload: string) {
  const [iv, tag, data] = payload.split(".").map((part) => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
