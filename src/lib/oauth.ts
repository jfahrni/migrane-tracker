import crypto from "crypto";
import { prisma } from "@/lib/prisma";

export const OAUTH_CODE_TTL_MS = 10 * 60 * 1000;
export const OAUTH_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;
export const OAUTH_SUPPORTED_SCOPES = ["read"] as const;

export function generateToken(byteLength = 32): string {
  return crypto.randomBytes(byteLength).toString("base64url");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function verifyPkceS256(verifier: string, challenge: string): boolean {
  const expected = crypto.createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(expected);
  const b = Buffer.from(challenge);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function scopesValid(scopes: string[]): boolean {
  return scopes.every((s) => (OAUTH_SUPPORTED_SCOPES as readonly string[]).includes(s));
}

export async function registerClient(input: { clientName: string; redirectUris: string[] }) {
  const clientId = generateToken(16);
  return prisma.oAuthClient.create({
    data: {
      clientId,
      clientName: input.clientName,
      redirectUris: JSON.stringify(input.redirectUris),
    },
  });
}

export async function getClient(clientId: string) {
  return prisma.oAuthClient.findUnique({ where: { clientId } });
}

export function clientAllowsRedirect(
  client: { redirectUris: string },
  redirectUri: string
): boolean {
  try {
    const uris: string[] = JSON.parse(client.redirectUris);
    return uris.includes(redirectUri);
  } catch {
    return false;
  }
}

export async function createAuthorizationCode(input: {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  codeChallenge: string;
}) {
  const code = generateToken(32);
  await prisma.oAuthCode.create({
    data: {
      code,
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      scopes: input.scopes.join(" "),
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: "S256",
      expiresAt: new Date(Date.now() + OAUTH_CODE_TTL_MS),
    },
  });
  return code;
}

export async function consumeAuthorizationCode(
  code: string,
  clientId: string,
  redirectUri: string
) {
  const record = await prisma.oAuthCode.findUnique({ where: { code } });
  if (!record) return null;
  if (record.clientId !== clientId) return null;
  if (record.redirectUri !== redirectUri) return null;
  if (record.usedAt) return null;
  if (record.expiresAt < new Date()) return null;

  await prisma.oAuthCode.update({ where: { code }, data: { usedAt: new Date() } });
  return record;
}

export async function createAccessToken(clientId: string, scopes: string[]) {
  const raw = generateToken(40);
  await prisma.oAuthToken.create({
    data: {
      tokenHash: hashToken(raw),
      clientId,
      scopes: scopes.join(" "),
      expiresAt: new Date(Date.now() + OAUTH_TOKEN_TTL_MS),
    },
  });
  return raw;
}

export async function verifyAccessToken(token?: string) {
  if (!token) return null;
  const hash = hashToken(token);
  const record = await prisma.oAuthToken.findUnique({ where: { tokenHash: hash } });
  if (!record) return null;
  if (record.expiresAt < new Date()) return null;
  return record;
}

export async function pruneExpiredOAuthRecords() {
  const now = new Date();
  await Promise.all([
    prisma.oAuthCode.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.oAuthToken.deleteMany({ where: { expiresAt: { lt: now } } }),
  ]);
}
