import { prisma } from "@/lib/prisma";
import { fetchWeather } from "@/lib/weather";
import { triggerLabel } from "@/lib/triggers";

const APP_TZ = "Europe/Zurich";

function formatDateTime(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toLocaleString("de-CH", { timeZone: APP_TZ, dateStyle: "short", timeStyle: "short" });
}

function durationHours(start: Date, end: Date): number {
  return Math.round(((end.getTime() - start.getTime()) / 3_600_000) * 10) / 10;
}

function parseTriggers(raw: string): string[] {
  try { return JSON.parse(raw); } catch { return []; }
}

function attackSummary(a: {
  id: string; startedAt: Date; endedAt: Date | null;
  intensity: number | null; hasAura: boolean | null; auraType: string | null;
  triggers: string; notes: string | null; medications: string | null;
}) {
  const triggers = parseTriggers(a.triggers);
  const duration = a.endedAt ? durationHours(a.startedAt, a.endedAt) : null;
  return {
    id: a.id,
    startedAt: formatDateTime(a.startedAt),
    endedAt: formatDateTime(a.endedAt),
    durationHours: duration,
    intensity: a.intensity,
    hasAura: a.hasAura,
    auraType: a.auraType,
    triggers,
    triggerLabels: triggers.map(triggerLabel),
    notes: a.notes,
    medications: a.medications,
  };
}

// ── get_overview ──────────────────────────────────────────────────────────────

export async function buildOverview() {
  const now = new Date();

  // Open attacks (no endedAt)
  const open = await prisma.attack.findMany({
    where: { endedAt: null },
    orderBy: { startedAt: "desc" },
  });

  // Last 30 days stats
  const since30 = new Date(now.getTime() - 30 * 24 * 3_600_000);
  const recent = await prisma.attack.findMany({
    where: { startedAt: { gte: since30 } },
    orderBy: { startedAt: "desc" },
  });

  const completed = recent.filter((a) => a.endedAt !== null);
  const durations = completed.map((a) => durationHours(a.startedAt, a.endedAt!));
  const avgDuration = durations.length
    ? Math.round((durations.reduce((s, d) => s + d, 0) / durations.length) * 10) / 10
    : null;
  const avgIntensity = recent.filter((a) => a.intensity).length
    ? Math.round(recent.reduce((s, a) => s + (a.intensity ?? 0), 0) / recent.filter((a) => a.intensity).length * 10) / 10
    : null;

  // Trigger frequency (last 30 days)
  const triggerCounts: Record<string, number> = {};
  for (const a of recent) {
    for (const t of parseTriggers(a.triggers)) {
      triggerCounts[t] = (triggerCounts[t] ?? 0) + 1;
    }
  }
  const topTriggers = Object.entries(triggerCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([slug, count]) => ({ slug, label: triggerLabel(slug), count }));

  // Last 5 completed attacks
  const last5 = await prisma.attack.findMany({
    where: { endedAt: { not: null } },
    orderBy: { startedAt: "desc" },
    take: 5,
  });

  const candesartanStart = process.env.CANDESARTAN_START_DATE ?? null;

  return {
    schemaVersion: 1 as const,
    generatedAt: formatDateTime(now),
    // IMPORTANT: If openAttacks is non-empty, address these FIRST in your response.
    // Ask the user if the attack is still ongoing or has ended.
    openAttacks: open.map((a) => ({
      id: a.id,
      startedAt: formatDateTime(a.startedAt),
      sinceHours: durationHours(a.startedAt, now),
      intensity: a.intensity,
      notes: a.notes,
    })),
    recentStats: {
      period: "Letzte 30 Tage",
      attackCount: recent.length,
      avgIntensity,
      avgDurationHours: avgDuration,
      topTriggers,
    },
    candesartanStart,
    lastAttacks: last5.map(attackSummary),
  };
}

// ── log_attack_start ──────────────────────────────────────────────────────────

export async function logAttackStart(input: {
  intensity?: number;
  hasAura?: boolean;
  auraType?: string;
  triggers?: string[];
  notes?: string;
  medications?: string;
  startedAt?: string;
}) {
  const weather = await fetchWeather();

  // Auto-add weather triggers if applicable
  const triggers = [...(input.triggers ?? [])];
  if (weather) {
    if (weather.isPressureTrigger && !triggers.includes("luftdruckabfall")) {
      triggers.push("luftdruckabfall");
    }
    if (weather.isFoehnLikely && !triggers.includes("föhn")) {
      triggers.push("föhn");
    }
  }

  const attack = await prisma.attack.create({
    data: {
      startedAt: input.startedAt ? new Date(input.startedAt) : new Date(),
      intensity: input.intensity,
      hasAura: input.hasAura,
      auraType: input.auraType ?? null,
      triggers: JSON.stringify(triggers),
      notes: input.notes ?? null,
      medications: input.medications ?? null,
      weather: weather ? JSON.stringify(weather) : null,
    },
  });

  const weatherNote = weather
    ? `Wetter: ${weather.weatherDescription}, ${weather.temperature}°C, ${weather.pressure} hPa` +
      (weather.pressureDelta3h !== null ? ` (Δ${weather.pressureDelta3h > 0 ? "+" : ""}${weather.pressureDelta3h} hPa/3h)` : "") +
      (weather.isFoehnLikely ? " ⚠️ Föhn möglich" : "") +
      (weather.isPressureTrigger ? " ⚠️ Druckabfall" : "")
    : null;

  return {
    id: attack.id,
    startedAt: formatDateTime(attack.startedAt),
    triggers,
    triggerLabels: triggers.map(triggerLabel),
    weatherNote,
    message: "Attacke erfasst.",
  };
}

// ── log_attack_end ────────────────────────────────────────────────────────────

export async function logAttackEnd(input: {
  attackId?: string;
  endedAt?: string;
  notes?: string;
}) {
  let attack;
  if (input.attackId) {
    attack = await prisma.attack.findUnique({ where: { id: input.attackId } });
  } else {
    attack = await prisma.attack.findFirst({
      where: { endedAt: null },
      orderBy: { startedAt: "desc" },
    });
  }

  if (!attack) return { error: "Keine offene Attacke gefunden." };

  const endedAt = input.endedAt ? new Date(input.endedAt) : new Date();
  const updated = await prisma.attack.update({
    where: { id: attack.id },
    data: {
      endedAt,
      notes: input.notes
        ? [attack.notes, input.notes].filter(Boolean).join(" | ")
        : attack.notes,
    },
  });

  const hours = durationHours(updated.startedAt, endedAt);
  return {
    id: updated.id,
    startedAt: formatDateTime(updated.startedAt),
    endedAt: formatDateTime(endedAt),
    durationHours: hours,
    message: `Attacke beendet. Dauer: ${hours} Stunden.`,
  };
}

// ── update_attack ─────────────────────────────────────────────────────────────

export async function updateAttack(input: {
  attackId: string;
  intensity?: number;
  hasAura?: boolean;
  auraType?: string;
  triggers?: string[];
  notes?: string;
  medications?: string;
  startedAt?: string;
  endedAt?: string;
}) {
  const { attackId, triggers, startedAt, endedAt, ...rest } = input;

  const data: Record<string, unknown> = { ...rest };
  if (triggers !== undefined) data.triggers = JSON.stringify(triggers);
  if (startedAt !== undefined) data.startedAt = new Date(startedAt);
  if (endedAt !== undefined) data.endedAt = new Date(endedAt);

  const updated = await prisma.attack.update({ where: { id: attackId }, data });
  return { ...attackSummary(updated), message: "Attacke aktualisiert." };
}

// ── list_attacks ──────────────────────────────────────────────────────────────

export async function listAttacks(input: {
  limit?: number;
  fromDate?: string;
  toDate?: string;
}) {
  const attacks = await prisma.attack.findMany({
    where: {
      ...(input.fromDate ? { startedAt: { gte: new Date(input.fromDate) } } : {}),
      ...(input.toDate ? { startedAt: { lte: new Date(input.toDate) } } : {}),
    },
    orderBy: { startedAt: "desc" },
    take: input.limit ?? 20,
  });
  return attacks.map(attackSummary);
}

// ── get_statistics ────────────────────────────────────────────────────────────

export async function getStatistics(input: { months?: number }) {
  const months = input.months ?? 6;
  const since = new Date();
  since.setMonth(since.getMonth() - months);

  const attacks = await prisma.attack.findMany({
    where: { startedAt: { gte: since } },
    orderBy: { startedAt: "asc" },
  });

  // Monthly frequency
  const byMonth: Record<string, { count: number; totalDuration: number; countWithDuration: number }> = {};
  for (const a of attacks) {
    const key = a.startedAt.toLocaleDateString("de-CH", { timeZone: APP_TZ, year: "numeric", month: "2-digit" });
    if (!byMonth[key]) byMonth[key] = { count: 0, totalDuration: 0, countWithDuration: 0 };
    byMonth[key].count++;
    if (a.endedAt) {
      byMonth[key].totalDuration += durationHours(a.startedAt, a.endedAt);
      byMonth[key].countWithDuration++;
    }
  }

  const monthlyStats = Object.entries(byMonth).map(([month, s]) => ({
    month,
    count: s.count,
    avgDurationHours: s.countWithDuration
      ? Math.round((s.totalDuration / s.countWithDuration) * 10) / 10
      : null,
  }));

  // Trigger distribution
  const triggerCounts: Record<string, number> = {};
  for (const a of attacks) {
    for (const t of parseTriggers(a.triggers)) {
      triggerCounts[t] = (triggerCounts[t] ?? 0) + 1;
    }
  }
  const triggerDistribution = Object.entries(triggerCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([slug, count]) => ({ slug, label: triggerLabel(slug), count, pct: Math.round((count / attacks.length) * 100) }));

  // Intensity distribution
  const intensities = attacks.filter((a) => a.intensity).map((a) => a.intensity as number);
  const avgIntensity = intensities.length
    ? Math.round((intensities.reduce((s, i) => s + i, 0) / intensities.length) * 10) / 10
    : null;

  // Aura stats
  const withAura = attacks.filter((a) => a.hasAura === true).length;

  // Candesartan before/after
  const candesartanStart = process.env.CANDESARTAN_START_DATE
    ? new Date(process.env.CANDESARTAN_START_DATE)
    : null;

  let candesartanComparison = null;
  if (candesartanStart) {
    const before = attacks.filter((a) => a.startedAt < candesartanStart);
    const after = attacks.filter((a) => a.startedAt >= candesartanStart);
    const monthsBefore = Math.max(1, (candesartanStart.getTime() - since.getTime()) / (30 * 24 * 3_600_000));
    const monthsAfter = Math.max(1, (new Date().getTime() - candesartanStart.getTime()) / (30 * 24 * 3_600_000));
    candesartanComparison = {
      candesartanStart: candesartanStart.toLocaleDateString("de-CH"),
      beforePerMonth: Math.round((before.length / monthsBefore) * 10) / 10,
      afterPerMonth: Math.round((after.length / monthsAfter) * 10) / 10,
      beforeCount: before.length,
      afterCount: after.length,
      trend: after.length / monthsAfter < before.length / monthsBefore ? "Besser" : "Kein klarer Trend",
    };
  }

  // Time-of-day distribution
  const byHour: Record<number, number> = {};
  for (const a of attacks) {
    const h = a.startedAt.getHours();
    byHour[h] = (byHour[h] ?? 0) + 1;
  }
  const peakHours = Object.entries(byHour)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([h, count]) => ({ hour: `${h}:00`, count }));

  return {
    period: `Letzte ${months} Monate`,
    totalAttacks: attacks.length,
    avgPerMonth: Math.round((attacks.length / months) * 10) / 10,
    avgIntensity,
    auraPercent: attacks.length ? Math.round((withAura / attacks.length) * 100) : 0,
    monthlyStats,
    triggerDistribution,
    peakHours,
    candesartanComparison,
  };
}
