import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  getClient, consumeAuthorizationCode, createAccessToken,
  verifyPkceS256, OAUTH_TOKEN_TTL_MS, pruneExpiredOAuthRecords,
} from "@/lib/oauth";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? "unknown";
  const rl = await checkRateLimit(`oauth-token:${ip}`, 30, 60_000);
  if (rl.limited) return NextResponse.json({ error: "too_many_requests" }, { status: 429 });

  let params: Record<string, string>;
  const ct = req.headers.get("content-type") ?? "";
  try {
    params = ct.includes("application/json")
      ? await req.json()
      : Object.fromEntries(await req.formData()) as Record<string, string>;
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { grant_type, code, redirect_uri, client_id: clientId, code_verifier: codeVerifier } = params;

  if (grant_type !== "authorization_code") return NextResponse.json({ error: "unsupported_grant_type" }, { status: 400 });
  if (!code || !redirect_uri || !clientId || !codeVerifier) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const client = await getClient(clientId);
  if (!client) {
    console.error("[oauth/token] invalid_client:", clientId);
    return NextResponse.json({ error: "invalid_client" }, { status: 401 });
  }

  const record = await consumeAuthorizationCode(code, clientId, redirect_uri);
  if (!record) {
    console.error("[oauth/token] invalid_grant — code lookup failed. clientId:", clientId, "redirect_uri:", redirect_uri, "code_prefix:", code?.slice(0, 8));
    return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
  }

  if (!verifyPkceS256(codeVerifier, record.codeChallenge)) {
    console.error("[oauth/token] PKCE failed. challenge:", record.codeChallenge, "verifier_prefix:", codeVerifier?.slice(0, 8));
    return NextResponse.json({ error: "invalid_grant", error_description: "PKCE failed" }, { status: 400 });
  }

  const scopes = record.scopes.split(" ").filter(Boolean);
  const accessToken = await createAccessToken(clientId, scopes);

  pruneExpiredOAuthRecords().catch(() => {});

  return NextResponse.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: Math.floor(OAUTH_TOKEN_TTL_MS / 1000),
    scope: record.scopes,
  });
}
