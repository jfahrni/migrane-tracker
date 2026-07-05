import { NextResponse, type NextRequest } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

// Öffentliche Pfade, die KEINE Session brauchen:
//  - /login, /api/auth/*      → Login-Flow selbst
//  - /api/mcp                 → Bearer-Token/OAuth (Maschinen-Auth, eigene Prüfung)
//  - /api/oauth/*, /oauth/*   → OAuth-Flow (self-guarding: die Consent-Seite leitet
//                               selbst zu /login?next=… um, damit next erhalten bleibt)
//  - /.well-known/*           → OAuth-Discovery
function isPublic(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/mcp") ||
    pathname.startsWith("/api/oauth/") ||
    pathname.startsWith("/oauth/") ||
    pathname.startsWith("/.well-known/")
  );
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const method = req.method;
  const ip = req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? "?";
  console.log(`[REQ] ${method} ${pathname}${search} — ${ip}`);

  if (isPublic(pathname)) return NextResponse.next();

  // Alles andere (Dashboard "/" und künftige App-Seiten) verlangt eine gültige Session.
  const user = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname + search);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
