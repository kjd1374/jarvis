// Only public verification code is shipped to runners. Signing keys stay on Jarvis.
import { createPrivateKey, createPublicKey, randomUUID, sign, verify } from "node:crypto";

export function previewOrigin(value) {
  if (typeof value !== "string" || !/^https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com\/$/.test(value)) return null;
  return new URL(value).origin;
}
export function ticketPublicKey(encodedPrivateKey) {
  const key = createPrivateKey({ key: Buffer.from(encodedPrivateKey, "base64"), format: "der", type: "pkcs8" });
  if (key.asymmetricKeyType !== "ed25519") throw new Error("invalid_preview_key");
  return createPublicKey(key).export({ format: "der", type: "spki" }).toString("base64");
}
export function issuePreviewTicket(encodedPrivateKey, claims, clock = Date.now()) {
  const key = createPrivateKey({ key: Buffer.from(encodedPrivateKey, "base64"), format: "der", type: "pkcs8" });
  if (key.asymmetricKeyType !== "ed25519") throw new Error("invalid_preview_key");
  const payload = Buffer.from(JSON.stringify({ ...claims, iat: Math.floor(clock / 1000), exp: Math.floor(clock / 1000) + 60, jti: randomUUID() })).toString("base64url");
  return `${payload}.${sign(null, Buffer.from(payload), key).toString("base64url")}`;
}
export function verifyPreviewTicket(ticket, publicKey, expected, clock = Date.now()) {
  if (typeof ticket !== "string" || ticket.length > 6000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(ticket)) throw new Error("invalid_preview_ticket");
  const [payload, signature] = ticket.split(".");
  const key = createPublicKey({ key: Buffer.from(publicKey, "base64"), format: "der", type: "spki" });
  if (key.asymmetricKeyType !== "ed25519" || !verify(null, Buffer.from(payload), key, Buffer.from(signature, "base64url"))) throw new Error("invalid_preview_ticket");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  if (!claims || !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) || claims.exp <= clock / 1000 ||
    claims.iat > clock / 1000 + 5 || claims.exp - claims.iat !== 60 ||
    !/^[a-f0-9-]{36}$/.test(claims.jti ?? "") || !/^[a-f0-9-]{36}$/.test(claims.sub ?? "") ||
    Object.entries(expected).some(([key, value]) => claims[key] !== value)) throw new Error("invalid_preview_ticket");
  return claims;
}
