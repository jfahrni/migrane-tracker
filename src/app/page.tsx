import { prisma } from "@/lib/prisma";
import { triggerLabel } from "@/lib/triggers";

export const dynamic = "force-dynamic";

const APP_TZ = "Europe/Zurich";

function fmt(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleString("de-CH", { timeZone: APP_TZ, dateStyle: "short", timeStyle: "short" });
}

function durationH(start: Date, end: Date): string {
  const h = (end.getTime() - start.getTime()) / 3_600_000;
  return `${Math.round(h * 10) / 10}h`;
}

function parseTriggers(raw: string): string[] {
  try { return JSON.parse(raw); } catch { return []; }
}

export default async function Dashboard() {
  const now = new Date();

  // Last 90 days
  const since90 = new Date(now.getTime() - 90 * 24 * 3_600_000);
  const attacks = await prisma.attack.findMany({
    where: { startedAt: { gte: since90 } },
    orderBy: { startedAt: "desc" },
  });

  // Monthly buckets
  const byMonth: Record<string, number> = {};
  for (const a of attacks) {
    const key = a.startedAt.toLocaleString("de-CH", { timeZone: APP_TZ, month: "short", year: "2-digit" });
    byMonth[key] = (byMonth[key] ?? 0) + 1;
  }

  // Trigger counts
  const triggerCounts: Record<string, number> = {};
  for (const a of attacks) {
    for (const t of parseTriggers(a.triggers)) {
      triggerCounts[t] = (triggerCounts[t] ?? 0) + 1;
    }
  }
  const topTriggers = Object.entries(triggerCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const openAttacks = attacks.filter((a) => !a.endedAt);
  const completed = attacks.filter((a) => a.endedAt);
  const durations = completed.map((a) => (a.endedAt!.getTime() - a.startedAt.getTime()) / 3_600_000);
  const avgDuration = durations.length
    ? Math.round((durations.reduce((s, d) => s + d, 0) / durations.length) * 10) / 10
    : null;
  const avgIntensity = attacks.filter((a) => a.intensity).length
    ? Math.round(attacks.reduce((s, a) => s + (a.intensity ?? 0), 0) / attacks.filter((a) => a.intensity).length * 10) / 10
    : null;

  const maxCount = Math.max(...Object.values(byMonth), 1);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6 max-w-4xl mx-auto space-y-8">
      <header className="flex items-center gap-3">
        <span className="text-3xl">🧠</span>
        <div>
          <h1 className="text-xl font-semibold">Migräne-Tracker</h1>
          <p className="text-sm text-zinc-500">Letzte 90 Tage</p>
        </div>
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Attacken", value: attacks.length },
          { label: "Ø Dauer", value: avgDuration ? `${avgDuration}h` : "—" },
          { label: "Ø Intensität", value: avgIntensity ?? "—" },
          { label: "Offen", value: openAttacks.length, warn: openAttacks.length > 0 },
        ].map((kpi) => (
          <div key={kpi.label} className={`rounded-xl border p-4 ${kpi.warn ? "border-amber-500/40 bg-amber-500/5" : "border-zinc-800 bg-zinc-900"}`}>
            <div className={`text-2xl font-bold ${kpi.warn ? "text-amber-400" : "text-white"}`}>{kpi.value}</div>
            <div className="text-xs text-zinc-500 mt-1">{kpi.label}</div>
          </div>
        ))}
      </div>

      {/* Open attacks warning */}
      {openAttacks.length > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
          <p className="text-sm font-medium text-amber-400">Offene Attacke</p>
          {openAttacks.map((a) => (
            <p key={a.id} className="text-xs text-zinc-400 mt-1">
              Seit {fmt(a.startedAt)} — erzähl Claude, wenn sie vorbei ist
            </p>
          ))}
        </div>
      )}

      {/* Monthly bar chart */}
      {Object.keys(byMonth).length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wide">Monatliche Häufigkeit</h2>
          <div className="space-y-2">
            {Object.entries(byMonth).reverse().map(([month, count]) => (
              <div key={month} className="flex items-center gap-3">
                <span className="text-xs text-zinc-500 w-14 text-right">{month}</span>
                <div className="flex-1 bg-zinc-800 rounded-full h-5 overflow-hidden">
                  <div
                    className="h-full bg-violet-600 rounded-full flex items-center px-2"
                    style={{ width: `${Math.max(8, (count / maxCount) * 100)}%` }}
                  >
                    <span className="text-xs text-white font-medium">{count}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Top triggers */}
      {topTriggers.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wide">Häufigste Trigger</h2>
          <div className="flex flex-wrap gap-2">
            {topTriggers.map(([slug, count]) => (
              <span key={slug} className="inline-flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-full px-3 py-1 text-sm">
                {triggerLabel(slug)}
                <span className="text-zinc-500 text-xs">{count}×</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Recent attacks table */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wide">Letzte Attacken</h2>
        <div className="rounded-xl border border-zinc-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-zinc-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2">Start</th>
                <th className="text-left px-4 py-2">Dauer</th>
                <th className="text-left px-4 py-2">Int.</th>
                <th className="text-left px-4 py-2">Aura</th>
                <th className="text-left px-4 py-2">Trigger</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {attacks.slice(0, 20).map((a) => (
                <tr key={a.id} className="hover:bg-zinc-900/50">
                  <td className="px-4 py-2 text-zinc-300 whitespace-nowrap">{fmt(a.startedAt)}</td>
                  <td className="px-4 py-2 text-zinc-400">
                    {a.endedAt ? durationH(a.startedAt, a.endedAt) : <span className="text-amber-400">offen</span>}
                  </td>
                  <td className="px-4 py-2">
                    {a.intensity ? (
                      <span className={`font-medium ${a.intensity >= 8 ? "text-red-400" : a.intensity >= 5 ? "text-amber-400" : "text-green-400"}`}>
                        {a.intensity}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-2 text-zinc-500">
                    {a.hasAura === true ? "✓" : a.hasAura === false ? "✗" : "—"}
                  </td>
                  <td className="px-4 py-2 text-zinc-500 text-xs max-w-xs truncate">
                    {parseTriggers(a.triggers).map(triggerLabel).join(", ") || "—"}
                  </td>
                </tr>
              ))}
              {attacks.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-zinc-600">
                    Noch keine Attacken erfasst. Erzähl Claude von deiner nächsten Migräne.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
