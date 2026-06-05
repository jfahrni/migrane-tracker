import { NextRequest, NextResponse } from "next/server";
import { getClient, clientAllowsRedirect, createAuthorizationCode, scopesValid } from "@/lib/oauth";
import { checkRateLimit } from "@/lib/rate-limit";
import { timingSafeEqual, createHash } from "crypto";

function pinMatches(input: string, expected: string): boolean {
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** GET: validate OAuth params, redirect to consent page */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const clientId = p.get("client_id");
  const redirectUri = p.get("redirect_uri");
  const responseType = p.get("response_type");
  const scope = p.get("scope") ?? "read";
  const state = p.get("state") ?? "";
  const codeChallenge = p.get("code_challenge");
  const codeChallengeMethod = p.get("code_challenge_method");

  function errRedirect(error: string, desc: string) {
    if (!redirectUri) return NextResponse.json({ error, error_description: desc }, { status: 400 });
    const u = new URL(redirectUri);
    u.searchParams.set("error", error);
    u.searchParams.set("error_description", desc);
    if (state) u.searchParams.set("state", state);
    return NextResponse.redirect(u.toString());
  }

  if (!clientId || !redirectUri) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  if (responseType !== "code") return errRedirect("unsupported_response_type", "Only 'code' is supported");
  if (!codeChallenge) return errRedirect("invalid_request", "code_challenge required (PKCE)");
  if (codeChallengeMethod !== "S256") return errRedirect("invalid_request", "code_challenge_method must be S256");

  const scopes = scope.split(" ").filter(Boolean);
  if (!scopesValid(scopes)) return errRedirect("invalid_scope", "Unsupported scope");

  const client = await getClient(clientId);
  if (!client) return errRedirect("invalid_client", "Unknown client_id");
  if (!clientAllowsRedirect(client, redirectUri)) return errRedirect("invalid_redirect_uri", "redirect_uri not registered");

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  const proto = req.headers.get("x-forwarded-proto")?.split(",").at(-1)?.trim() ?? "https";
  const consentUrl = new URL("/oauth/authorize", `${proto}://${host}`);
  consentUrl.searchParams.set("client_id", clientId);
  consentUrl.searchParams.set("redirect_uri", redirectUri);
  consentUrl.searchParams.set("scope", scopes.join(" "));
  consentUrl.searchParams.set("state", state);
  consentUrl.searchParams.set("code_challenge", codeChallenge);
  consentUrl.searchParams.set("client_name", client.clientName);
  return NextResponse.redirect(consentUrl.toString());
}

/** POST: PIN-gated consent — issues authorization code */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? "unknown";
  const rl = await checkRateLimit(`oauth-consent:${ip}`, 10, 60_000);
  if (rl.limited) return NextResponse.json({ error: "too_many_requests" }, { status: 429 });

  let body: Record<string, string>;
  try { body = Object.fromEntries((await req.formData()).entries()) as Record<string, string>; }
  catch { return NextResponse.json({ error: "invalid_request" }, { status: 400 }); }

  const { client_id: clientId, redirect_uri: redirectUri, scope, state, code_challenge: codeChallenge, pin } = body;

  const expectedPin = process.env.MCP_CONSENT_PIN;
  if (!expectedPin || !pin || !pinMatches(pin, expectedPin)) {
    return NextResponse.json({ error: "access_denied", error_description: "Falscher PIN" }, { status: 403 });
  }

  if (!clientId || !redirectUri || !codeChallenge) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const client = await getClient(clientId);
  if (!client || !clientAllowsRedirect(client, redirectUri)) return NextResponse.json({ error: "invalid_client" }, { status: 400 });

  const scopes = (scope ?? "read").split(" ").filter(Boolean);
  if (!scopesValid(scopes)) return NextResponse.json({ error: "invalid_scope" }, { status: 400 });

  const code = await createAuthorizationCode({ clientId, redirectUri, scopes, codeChallenge });

  const callbackUrl = new URL(redirectUri);
  callbackUrl.searchParams.set("code", code);
  if (state) callbackUrl.searchParams.set("state", state);
  // 302 (nicht 307) damit der Browser die Callback-URL per GET aufruft
  return NextResponse.redirect(callbackUrl.toString(), { status: 302 });
}
