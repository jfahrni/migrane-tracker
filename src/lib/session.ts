// Edge-taugliche Session-Signatur/-Prüfung via Web Crypto (globalThis.crypto.subtle).
// KEIN Import von "node:crypto" — dieses Modul wird von der Middleware (Edge-Runtime)
// importiert, wo node:crypto nicht verfügbar ist.

export const SESSION_COOKIE = "mt_session";
export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60; // 30 Tage

interface SessionPayload {
  u: string; // Username
  exp: number; // Ablauf (epoch ms)
}

function getSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    throw new Error("AUTH_SECRET ist nicht gesetzt oder zu kurz (min. 16 Zeichen).");
  }
  return s;
}

// ── base64url ohne Buffer (edge-tauglich) ────────────────────────────────────
function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const encoder = new TextEncoder();
/** UTF-8 → ArrayBuffer-backed Uint8Array (BufferSource-kompatibel für Web Crypto). */
function enc(s: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(encoder.encode(s));
}

async function importKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Signiert einen Session-Token für den Username (30 Tage gültig). */
export async function signSession(username: string): Promise<string> {
  const payload: SessionPayload = { u: username, exp: Date.now() + SESSION_MAX_AGE_S * 1000 };
  const payloadB64 = bytesToB64url(enc(JSON.stringify(payload)));
  const key = await importKey();
  const sig = await crypto.subtle.sign("HMAC", key, enc(payloadB64));
  return `${payloadB64}.${bytesToB64url(new Uint8Array(sig))}`;
}

/** Prüft einen Session-Token. Gibt den Username zurück oder null (ungültig/abgelaufen). */
export async function verifySession(token: string | undefined | null): Promise<string | null> {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);

  let ok = false;
  try {
    const key = await importKey();
    ok = await crypto.subtle.verify("HMAC", key, b64urlToBytes(sigB64), enc(payloadB64));
  } catch {
    return null;
  }
  if (!ok) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadB64))) as SessionPayload;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    if (typeof payload.u !== "string" || !payload.u) return null;
    return payload.u;
  } catch {
    return null;
  }
}
