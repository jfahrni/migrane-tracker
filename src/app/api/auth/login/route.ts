import { NextRequest, NextResponse } from "next/server";
import { verifyCredentials } from "@/lib/credentials";
import { signSession, SESSION_COOKIE, SESSION_MAX_AGE_S } from "@/lib/session";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Nur relative Pfade zulassen (Open-Redirect-Schutz). */
function safeNext(next: unknown): string {
  if (typeof next !== "string") return "/";
  // Muss mit genau einem "/" beginnen und darf kein Protokoll/Host enthalten.
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? "unknown";
  const rl = await checkRateLimit(`login:${ip}`, 10, 15 * 60_000); // 10 Versuche / 15 Min
  if (rl.limited) {
    return NextResponse.json(
      { error: "too_many_requests", error_description: "Zu viele Versuche. Bitte später erneut." },
      { status: 429, headers: rl.retryAfter ? { "Retry-After": String(rl.retryAfter) } : undefined },
    );
  }

  let username = "";
  let password = "";
  let next = "/";
  const ct = req.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/json")) {
      const b = await req.json();
      username = String(b.username ?? "");
      password = String(b.password ?? "");
      next = safeNext(b.next);
    } else {
      const f = await req.formData();
      username = String(f.get("username") ?? "");
      password = String(f.get("password") ?? "");
      next = safeNext(f.get("next"));
    }
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  if (!verifyCredentials(username, password)) {
    return NextResponse.json(
      { error: "invalid_credentials", error_description: "Benutzername oder Passwort falsch." },
      { status: 401 },
    );
  }

  const token = await signSession(username);
  const res = NextResponse.json({ ok: true, next });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
  return res;
}
