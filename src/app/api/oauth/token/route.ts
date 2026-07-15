import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  getClient, consumeAuthorizationCode, createAccessToken, createRefreshToken, verifyRefreshToken,
  verifyPkceS256, OAUTH_TOKEN_TTL_MS, pruneExpiredOAuthRecords,
} from "@/lib/oauth";

// Browser-Clients (claude.ai Web/Desktop) tauschen den Token cross-origin — ohne
// diese Header verwirft der Browser die Antwort.
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};
function corsJson(body: unknown, init?: { status?: number }): NextResponse {
  return NextResponse.json(body, { status: init?.status ?? 200, headers: CORS });
}

/** Standard-Token-Response (access + refresh + Metadaten). */
function tokenResponse(accessToken: string, refreshToken: string, scope: string): NextResponse {
  return corsJson({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: Math.floor(OAUTH_TOKEN_TTL_MS / 1000),
    refresh_token: refreshToken,
    scope,
  });
}

export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * POST /api/oauth/token — Token-Endpoint (RFC 6749). Unterstützt:
 *  - grant_type=authorization_code (§4.1.3, PKCE S256) → access + refresh token
 *  - grant_type=refresh_token (§6) → neuer access token, SELBER refresh token (nicht-rotierend)
 * Ohne Refresh muss der Client bei jeder Access-Token-Erneuerung den vollen Authorize-Flow
 * (inkl. Login) durchlaufen — das erzeugt die wiederholten Neu-Registrierungen.
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? "unknown";
  const rl = await checkRateLimit(`oauth-token:${ip}`, 30, 60_000);
  if (rl.limited) return corsJson({ error: "too_many_requests" }, { status: 429 });

  let params: Record<string, string>;
  const ct = req.headers.get("content-type") ?? "";
  try {
    params = ct.includes("application/json")
      ? await req.json()
      : Object.fromEntries(await req.formData()) as Record<string, string>;
  } catch {
    return corsJson({ error: "invalid_request" }, { status: 400 });
  }

  const { grant_type: grantType, client_id: clientId } = params;
  if (grantType === "authorization_code") return handleAuthorizationCode(params, clientId);
  if (grantType === "refresh_token") return handleRefreshToken(params, clientId);
  return corsJson({ error: "unsupported_grant_type" }, { status: 400 });
}

async function handleAuthorizationCode(params: Record<string, string>, clientId?: string): Promise<NextResponse> {
  const { code, redirect_uri: redirectUri, code_verifier: codeVerifier } = params;
  if (!code || !redirectUri || !clientId || !codeVerifier) return corsJson({ error: "invalid_request" }, { status: 400 });

  const client = await getClient(clientId);
  if (!client) {
    console.error("[oauth/token] invalid_client:", clientId);
    return corsJson({ error: "invalid_client" }, { status: 401 });
  }

  const record = await consumeAuthorizationCode(code, clientId, redirectUri);
  if (!record) {
    console.error("[oauth/token] invalid_grant — code lookup failed. clientId:", clientId, "redirect_uri:", redirectUri, "code_prefix:", code?.slice(0, 8));
    return corsJson({ error: "invalid_grant" }, { status: 400 });
  }

  if (!verifyPkceS256(codeVerifier, record.codeChallenge)) {
    console.error("[oauth/token] PKCE failed. challenge:", record.codeChallenge, "verifier_prefix:", codeVerifier?.slice(0, 8));
    return corsJson({ error: "invalid_grant", error_description: "PKCE failed" }, { status: 400 });
  }

  const scopes = record.scopes.split(" ").filter(Boolean);
  const [accessToken, refreshToken] = await Promise.all([
    createAccessToken(clientId, scopes),
    createRefreshToken(clientId, scopes),
  ]);
  pruneExpiredOAuthRecords().catch(() => {});
  return tokenResponse(accessToken, refreshToken, record.scopes);
}

async function handleRefreshToken(params: Record<string, string>, clientId?: string): Promise<NextResponse> {
  const refreshTokenRaw = params.refresh_token;
  if (!refreshTokenRaw || !clientId) return corsJson({ error: "invalid_request" }, { status: 400 });

  // Kein getClient nötig: ein gültiger Refresh-Token mit passender clientId impliziert den Client
  // (FK + onDelete:Cascade — ein gelöschter Client hätte keine Refresh-Tokens mehr).
  const record = await verifyRefreshToken(refreshTokenRaw);
  if (!record || record.clientId !== clientId) {
    console.error("[oauth/token] invalid refresh_token. clientId:", clientId);
    return corsJson({ error: "invalid_grant", error_description: "Refresh token invalid or expired" }, { status: 400 });
  }

  // Nicht-rotierend: neuer Access-Token, derselbe Refresh-Token zurück (vermeidet Rotation-Race).
  const scopes = record.scopes.split(" ").filter(Boolean);
  const accessToken = await createAccessToken(clientId, scopes);
  pruneExpiredOAuthRecords().catch(() => {});
  return tokenResponse(accessToken, refreshTokenRaw, record.scopes);
}
