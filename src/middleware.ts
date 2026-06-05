import { NextResponse, type NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const method = req.method;
  const ip = req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? "?";
  console.log(`[REQ] ${method} ${pathname}${search} — ${ip}`);
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
