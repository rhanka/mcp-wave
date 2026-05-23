import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function randomToken(byteLength = 32): string {
  return randomBytes(byteLength).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function tokenHashPrefix(tokenHash: string): string {
  return tokenHash.slice(0, 12);
}

export function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(sha256Hex(a), "hex");
  const right = Buffer.from(sha256Hex(b), "hex");
  return timingSafeEqual(left, right);
}
