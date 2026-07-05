// Node-only Passwort-Prüfung via scrypt. Wird ausschließlich vom Login-Route-Handler
// (Node-Runtime) importiert — NICHT von der Middleware (Edge-Runtime).

import { scryptSync, timingSafeEqual, createHash } from "crypto";

/** Constant-time String-Vergleich über SHA-256-Digests (längenunabhängig). */
function safeEqualStr(a: string, b: string): boolean {
  const da = createHash("sha256").update(a).digest();
  const db = createHash("sha256").update(b).digest();
  return timingSafeEqual(da, db);
}

/**
 * Prüft Username + Passwort gegen AUTH_USERNAME / AUTH_PASSWORD_HASH.
 * AUTH_PASSWORD_HASH-Format: "scrypt:<saltHex>:<hashHex>".
 * Beide Teilprüfungen werden immer ausgewertet (kein Short-Circuit → weniger Timing-Signal).
 */
export function verifyCredentials(username: string, password: string): boolean {
  const expectedUser = process.env.AUTH_USERNAME;
  const stored = process.env.AUTH_PASSWORD_HASH;
  if (!expectedUser || !stored) return false; // fail-closed

  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  if (salt.length === 0 || expected.length === 0) return false;

  let passOk = false;
  try {
    const derived = scryptSync(password, salt, expected.length);
    passOk = derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    passOk = false;
  }

  const userOk = safeEqualStr(username, expectedUser);
  return userOk && passOk;
}
