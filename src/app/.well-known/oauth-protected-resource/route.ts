import { NextResponse } from "next/server";

/**
 * GET /.well-known/oauth-protected-resource
 * OAuth 2.0 Protected Resource Metadata (RFC 9728).
 * Sagt MCP-Clients welcher Authorization Server diese Resource schützt.
 */
export async function GET(req: Request) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  const proto = req.headers.get("x-forwarded-proto")?.split(",").at(-1)?.trim() ?? "https";
  const base = `${proto}://${host}`;

  return NextResponse.json({
    resource: base,
    authorization_servers: [base],
    scopes_supported: ["read"],
    bearer_methods_supported: ["header"],
  });
}
