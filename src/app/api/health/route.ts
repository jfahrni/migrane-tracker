import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health — Liveness/Readiness für Docker und Traefik.
 * Prüft zusätzlich die DB, damit ein Container, dessen Migrationen noch laufen,
 * NICHT als bereit gilt und Traefik ihn erst gar nicht bedient. Bewusst leichtgewichtig
 * (SQLite läuft mit connection_limit=1 — ein teurer Check würde echte Requests ausbremsen).
 */
export async function GET() {
  try {
    // Bewusst eine APP-Tabelle, nicht "SELECT 1": letzteres gelingt auch, solange die
    // Migrationen noch nicht durch sind — der Container wäre dann fälschlich "bereit".
    // LIMIT 1 ohne Zeilen ist O(1) und belastet die Single-Connection nicht.
    await prisma.$queryRaw`SELECT 1 FROM "Attack" LIMIT 1`;
    return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { status: "degraded", error: (e as Error).message },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
