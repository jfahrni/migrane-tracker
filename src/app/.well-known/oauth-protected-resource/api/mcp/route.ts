import { NextResponse } from "next/server";
import { generateProtectedResourceMetadata } from "mcp-handler";
import { OAUTH_SUPPORTED_SCOPES } from "@/lib/oauth";

/**
 * GET /.well-known/oauth-protected-resource/api/mcp
 * Pfad-suffigierte Variante der Protected Resource Metadata (RFC 9728 §3.1):
 * für die Resource https://<host>/api/mcp liegt die Metadata unter genau diesem Pfad.
 * Browser-Clients (claude.ai Web/Desktop) fragen DIESE Variante ab und brechen den
 * Connect ab, wenn sie 404 liefert — die Root-Variante allein genügt ihnen nicht,
 * weil deren `resource`-Feld (Origin ohne Pfad) nicht zur MCP-URL passt.
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
    resourceUrl: `${base}/api/mcp`,
    additionalMetadata: { scopes_supported: [...OAUTH_SUPPORTED_SCOPES] },
  });
  return NextResponse.json(metadata, { headers: CORS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
