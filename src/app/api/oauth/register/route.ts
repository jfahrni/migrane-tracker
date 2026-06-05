import { NextRequest, NextResponse } from "next/server";
import { registerClient, OAUTH_SUPPORTED_SCOPES } from "@/lib/oauth";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? "unknown";
  const rl = await checkRateLimit(`oauth-register:${ip}`, 20, 60_000);
  if (rl.limited) return NextResponse.json({ error: "too_many_requests" }, { status: 429 });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_request" }, { status: 400 }); }

  const clientName = typeof body.client_name === "string" && body.client_name.trim()
    ? body.client_name.trim() : "Unknown Client";

  const rawUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  const redirectUris: string[] = [];
  for (const uri of rawUris) {
    if (typeof uri !== "string") continue;
    try {
      const p = new URL(uri);
      const ok = p.protocol === "https:" || p.hostname === "localhost" ||
        (!["http:", "javascript:", "data:", "file:"].includes(p.protocol));
      if (ok) redirectUris.push(uri);
    } catch { /* skip */ }
  }

  if (redirectUris.length === 0) {
    return NextResponse.json({ error: "invalid_redirect_uri" }, { status: 400 });
  }

  const client = await registerClient({ clientName, redirectUris });
  return NextResponse.json({
    client_id: client.clientId,
    client_name: client.clientName,
    redirect_uris: redirectUris,
    grant_types: ["authorization_code"],
    response_types: ["code"],
    scope: OAUTH_SUPPORTED_SCOPES.join(" "),
    token_endpoint_auth_method: "none",
  }, { status: 201 });
}
