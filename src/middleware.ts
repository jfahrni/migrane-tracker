import { NextResponse, type NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const method = req.method;
  const ip = req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? "?";
  console.log(`[REQ] ${method} ${pathname}${search} — ${ip}`);

  // Claude Mobile/Web nutzt die eingegebene Connector-URL (Root) als MCP-Endpoint
  // und schickt JSON-RPC-Requests an "/". Diese an den echten MCP-Handler umleiten.
  // Die HTML-Homepage (Accept: text/html) wird NICHT umgeleitet.
  if (pathname === "/") {
    const accept = req.headers.get("accept") ?? "";
    const isMcpRequest =
      method === "POST" ||
      method === "DELETE" ||
      (method === "GET" && accept.includes("text/event-stream"));
    const wantsHtml = accept.includes("text/html");

    if (isMcpRequest && !wantsHtml) {
      const url = req.nextUrl.clone();
      url.pathname = "/api/mcp";
      console.log(`[REWRITE] ${method} / → /api/mcp`);
      return NextResponse.rewrite(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
