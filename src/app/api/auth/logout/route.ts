import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

function clearCookie(res: NextResponse): NextResponse {
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}

/** POST /api/auth/logout — löscht das Session-Cookie (JSON-Antwort). */
export async function POST() {
  return clearCookie(NextResponse.json({ ok: true }));
}

/** GET /api/auth/logout — löscht das Cookie und leitet zur Login-Seite (für Link-Logout). */
export async function GET(req: Request) {
  const url = new URL("/login", req.url);
  return clearCookie(NextResponse.redirect(url, { status: 302 }));
}
