import { NextResponse } from "next/server";
import { generateProtectedResourceMetadata } from "mcp-handler";
import { OAUTH_SUPPORTED_SCOPES } from "@/lib/oauth";

/**
 * GET /.well-known/oauth-protected-resource
 * OAuth 2.0 Protected Resource Metadata (RFC 9728). Der Client entdeckt hierüber, welcher
 * Authorization-Server diese Resource absichert. Nutzt den offiziellen mcp-handler-Helper
 * und führt CORS, damit auch Browser-Clients (claude.ai) die Discovery lesen können.
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

function baseFrom(req: Request): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  const proto = req.headers.get("x-forwarded-proto")?.split(",").at(-1)?.trim() ?? "https";
  return `${proto}://${host}`;
}

export function GET(req: Request) {
  const base = baseFrom(req);
  const metadata = generateProtectedResourceMetadata({
    authServerUrls: [base],
    resourceUrl: base,
    additionalMetadata: { scopes_supported: [...OAUTH_SUPPORTED_SCOPES] },
  });
  return NextResponse.json(metadata, { headers: CORS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
