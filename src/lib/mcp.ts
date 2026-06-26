import { prisma } from "@/lib/prisma";
import { fetchWeather, type WeatherSnapshot } from "@/lib/weather";
import { triggerLabel } from "@/lib/triggers";
import { APP_TZ, parseLocalToInstant, hourInZone } from "@/lib/tz";

function formatDateTime(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toLocaleString("de-CH", { timeZone: APP_TZ, dateStyle: "short", timeStyle: "short" });
}

function formatDate(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toLocaleDateString("de-CH", { timeZone: APP_TZ });
}

function durationHours(start: Date, end: Date): number {
  return Math.round(((end.getTime() - start.getTime()) / 3_600_000) * 10) / 10;
}

function parseTriggers(raw: string): string[] {
  try { return JSON.parse(raw); } catch { return []; }
}

function parseWeather(raw: string | null): WeatherSnapshot | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as WeatherSnapshot; } catch { return null; }
}

// Kompakter Wetter-Auszug für list/overview (statt den vollen Snapshot).
function weatherDigest(raw: string | null) {
  const w = parseWeather(raw);
  if (!w) return null;
  return {
    condition: w.weatherDescription,
    temperature: w.temperature,
    pressure: w.pressure,
    pressureDelta3h: w.pressureDelta3h,
    isFoehnLikely: w.isFoehnLikely,
    isPressureTrigger: w.isPressureTrigger,
  };
}

type AttackRecord = {
  id: string; startedAt: Date; endedAt: Date | null;
  intensity: number | null; auraSeverity: number | null;
  hasAura: boolean | null; auraType: string | null;
  hadPostdrome: boolean | null; postdromeNotes: string | null;
  triggers: string; notes: string | null; medications: string | null;
  weather: string | null; episodeGroupId: string | null;
};

function attackSummary(a: AttackRecord) {
  const triggers = parseTriggers(a.triggers);
  const duration = a.endedAt ? durationHours(a.startedAt, a.endedAt) : null;
  return {
    id: a.id,
    startedAt: formatDateTime(a.startedAt),
    endedAt: formatDateTime(a.endedAt),
    durationHours: duration,
    intensity: a.intensity, // Kopfschmerz 0–10 (0 = schmerzfrei)
    auraSeverity: a.auraSeverity,
    hasAura: a.hasAura,
    auraType: a.auraType,
    hadPostdrome: a.hadPostdrome,
    postdromeNotes: a.postdromeNotes,
    triggers,
    triggerLabels: triggers.map(triggerLabel),
    notes: a.notes,
    medications: a.medications,
    weather: weatherDigest(a.weather),
    episodeGroupId: a.episodeGroupId,
  };
}

// ── Medikamenten-Phasen ─────────────────────────────────────────────────────
// Die Medication-Tabelle ist maßgeblich. Ist sie leer und CANDESARTAN_START_DATE
// gesetzt, wird einmalig ein Seed-Eintrag erzeugt (Migration aus der alten Env).

async function ensureSeedMedication() {
  const count = await prisma.medication.count();
  if (count > 0) return;
  const env = process.env.CANDESARTAN_START_DATE;
  if (!env) return;
  await prisma.medication.create({
    data: { name: "Candesartan", startedAt: parseLocalToInstant(env) },
  });
}

async function getPrimaryMedication() {
  await ensureSeedMedication();
  // Aktuell laufendes Präparat mit dem frühesten Start.
  return prisma.medication.findFirst({
    where: { endedAt: null },
    orderBy: { startedAt: "asc" },
  });
}

function dayNumber(start: Date, now: Date): number {
  return Math.floor((now.getTime() - start.getTime()) / 86_400_000) + 1;
}

// ── get_overview ──────────────────────────────────────────────────────────────

export async function buildOverview() {
  const now = new Date();

  const open = await prisma.attack.findMany({
    where: { endedAt: null },
    orderBy: { startedAt: "desc" },
  });

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

  // intensity ist jetzt 0–10; 0 (schmerzfrei) MUSS mitzählen → != null statt truthy.
  const withIntensity = recent.filter((a) => a.intensity !== null && a.intensity !== undefined);
  const avgIntensity = withIntensity.length
    ? Math.round((withIntensity.reduce((s, a) => s + (a.intensity ?? 0), 0) / withIntensity.length) * 10) / 10
    : null;
  const painFreeCount = withIntensity.filter((a) => a.intensity === 0).length;

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

  const last5 = await prisma.attack.findMany({
    where: { endedAt: { not: null } },
    orderBy: { startedAt: "desc" },
    take: 5,
  });

  const med = await getPrimaryMedication();
  const medication = med
    ? { name: med.name, startedAt: formatDate(med.startedAt), dayNumber: dayNumber(med.startedAt, now) }
    : null;

  return {
    schemaVersion: 2 as const,
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
      painFreeCount,
      withIntensityCount: withIntensity.length,
      avgDurationHours: avgDuration,
      topTriggers,
    },
    medication,
    lastAttacks: last5.map(attackSummary),
  };
}

// ── log_attack_start ──────────────────────────────────────────────────────────

export async function logAttackStart(input: {
  intensity?: number;
  auraSeverity?: number;
  hasAura?: boolean;
  auraType?: string;
  hadPostdrome?: boolean;
  postdromeNotes?: string;
  triggers?: string[];
  notes?: string;
  medications?: string;
  startedAt?: string;
  episodeGroupId?: string;
}) {
  const weather = await fetchWeather();

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
      startedAt: input.startedAt ? parseLocalToInstant(input.startedAt) : new Date(),
      intensity: input.intensity,
      auraSeverity: input.auraSeverity ?? null,
      hasAura: input.hasAura,
      auraType: input.auraType ?? null,
      hadPostdrome: input.hadPostdrome ?? null,
      postdromeNotes: input.postdromeNotes ?? null,
      triggers: JSON.stringify(triggers),
      notes: input.notes ?? null,
      medications: input.medications ?? null,
      weather: weather ? JSON.stringify(weather) : null,
      episodeGroupId: input.episodeGroupId ?? null,
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

  const endedAt = input.endedAt ? parseLocalToInstant(input.endedAt) : new Date();
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
  auraSeverity?: number;
  hasAura?: boolean;
  auraType?: string;
  hadPostdrome?: boolean;
  postdromeNotes?: string;
  triggers?: string[];
  notes?: string;
  medications?: string;
  startedAt?: string;
  endedAt?: string;
  episodeGroupId?: string;
}) {
  const { attackId, triggers, startedAt, endedAt, ...rest } = input;

  const data: Record<string, unknown> = { ...rest };
  if (triggers !== undefined) data.triggers = JSON.stringify(triggers);
  if (startedAt !== undefined) data.startedAt = parseLocalToInstant(startedAt);
  if (endedAt !== undefined) data.endedAt = parseLocalToInstant(endedAt);

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
      ...(input.fromDate ? { startedAt: { gte: parseLocalToInstant(input.fromDate) } } : {}),
      ...(input.toDate ? { startedAt: { lte: parseLocalToInstant(input.toDate) } } : {}),
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
    .map(([slug, count]) => ({ slug, label: triggerLabel(slug), count, pct: attacks.length ? Math.round((count / attacks.length) * 100) : 0 }));

  // Intensity: 0 (schmerzfrei) zählt mit; Schein-Mittel vermeiden.
  const withIntensity = attacks.filter((a) => a.intensity !== null && a.intensity !== undefined);
  const avgIntensity = withIntensity.length
    ? Math.round((withIntensity.reduce((s, a) => s + (a.intensity ?? 0), 0) / withIntensity.length) * 10) / 10
    : null;
  const painFreeCount = withIntensity.filter((a) => a.intensity === 0).length;

  // Aura
  const withAura = attacks.filter((a) => a.hasAura === true).length;
  const auraSeverities = attacks.filter((a) => a.auraSeverity != null).map((a) => a.auraSeverity as number);
  const avgAuraSeverity = auraSeverities.length
    ? Math.round((auraSeverities.reduce((s, i) => s + i, 0) / auraSeverities.length) * 10) / 10
    : null;

  // Postdrome
  const postdromeCount = attacks.filter((a) => a.hadPostdrome === true).length;

  // Wetter-Korrelation (rückwirkend aus persistierten Snapshots)
  const weathered = attacks.map((a) => parseWeather(a.weather)).filter((w): w is WeatherSnapshot => w !== null);
  const deltas = weathered.map((w) => w.pressureDelta3h).filter((d): d is number => d !== null);
  const weatherCorrelation = weathered.length
    ? {
        attacksWithWeatherData: weathered.length,
        ofTotal: attacks.length,
        fallingPressureCount: weathered.filter((w) => w.isPressureTrigger).length,
        foehnLikelyCount: weathered.filter((w) => w.isFoehnLikely).length,
        avgPressureHpa: Math.round((weathered.reduce((s, w) => s + w.pressure, 0) / weathered.length) * 10) / 10,
        avgPressureDelta3h: deltas.length
          ? Math.round((deltas.reduce((s, d) => s + d, 0) / deltas.length) * 10) / 10
          : null,
        avgTemperature: Math.round((weathered.reduce((s, w) => s + w.temperature, 0) / weathered.length) * 10) / 10,
      }
    : null;

  // Medikamenten-Vergleich (vorher/nachher) — nur mit echter Baseline.
  const med = await getPrimaryMedication();
  let medicationComparison = null;
  if (med) {
    const start = med.startedAt;
    const before = attacks.filter((a) => a.startedAt < start);
    const after = attacks.filter((a) => a.startedAt >= start);
    if (before.length === 0) {
      medicationComparison = {
        name: med.name,
        startedAt: formatDate(start),
        note: "Keine Vergleichsbasis — alle erfassten Attacken liegen nach dem Medikamenten-Start. Vorher/Nachher-Vergleich erst nach ausreichender Baseline möglich.",
        dayNumber: dayNumber(start, new Date()),
      };
    } else {
      const monthsBefore = Math.max(1, (start.getTime() - since.getTime()) / (30 * 24 * 3_600_000));
      const monthsAfter = Math.max(1, (new Date().getTime() - start.getTime()) / (30 * 24 * 3_600_000));
      const beforePerMonth = Math.round((before.length / monthsBefore) * 10) / 10;
      const afterPerMonth = Math.round((after.length / monthsAfter) * 10) / 10;
      medicationComparison = {
        name: med.name,
        startedAt: formatDate(start),
        dayNumber: dayNumber(start, new Date()),
        beforePerMonth,
        afterPerMonth,
        beforeCount: before.length,
        afterCount: after.length,
        trend: afterPerMonth < beforePerMonth ? "Besser" : "Kein klarer Trend",
      };
    }
  }

  // Time-of-day distribution — in Europe/Zurich, nicht Server-UTC.
  const byHour: Record<number, number> = {};
  for (const a of attacks) {
    const h = hourInZone(a.startedAt);
    byHour[h] = (byHour[h] ?? 0) + 1;
  }
  const peakHours = Object.entries(byHour)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([h, count]) => ({ hour: `${h}:00`, count }));

  // Episoden vs. Attacken (Schübe desselben Tages können gruppiert sein).
  const episodeIds = new Set<string>();
  let ungrouped = 0;
  for (const a of attacks) {
    if (a.episodeGroupId) episodeIds.add(a.episodeGroupId);
    else ungrouped++;
  }
  const episodeCount = episodeIds.size + ungrouped;

  return {
    period: `Letzte ${months} Monate`,
    totalAttacks: attacks.length,
    episodeCount,
    avgPerMonth: Math.round((attacks.length / months) * 10) / 10,
    avgIntensity,
    painFreeCount,
    withIntensityCount: withIntensity.length,
    auraPercent: attacks.length ? Math.round((withAura / attacks.length) * 100) : 0,
    avgAuraSeverity,
    postdromeCount,
    monthlyStats,
    triggerDistribution,
    peakHours,
    weatherCorrelation,
    medicationComparison,
  };
}

// ── Medikamente verwalten ───────────────────────────────────────────────────

export async function listMedications() {
  await ensureSeedMedication();
  const meds = await prisma.medication.findMany({ orderBy: { startedAt: "desc" } });
  const now = new Date();
  return meds.map((m) => ({
    id: m.id,
    name: m.name,
    startedAt: formatDate(m.startedAt),
    endedAt: formatDate(m.endedAt),
    dayNumber: m.endedAt ? null : dayNumber(m.startedAt, now),
    notes: m.notes,
  }));
}

export async function setMedication(input: {
  id?: string;
  name?: string;
  startedAt?: string;
  endedAt?: string;
  notes?: string;
}) {
  if (input.id) {
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.startedAt !== undefined) data.startedAt = parseLocalToInstant(input.startedAt);
    if (input.endedAt !== undefined) data.endedAt = parseLocalToInstant(input.endedAt);
    if (input.notes !== undefined) data.notes = input.notes;
    const updated = await prisma.medication.update({ where: { id: input.id }, data });
    return { id: updated.id, message: "Medikament aktualisiert." };
  }
  if (!input.name || !input.startedAt) {
    return { error: "name und startedAt sind für ein neues Medikament erforderlich." };
  }
  const created = await prisma.medication.create({
    data: {
      name: input.name,
      startedAt: parseLocalToInstant(input.startedAt),
      endedAt: input.endedAt ? parseLocalToInstant(input.endedAt) : null,
      notes: input.notes ?? null,
    },
  });
  return { id: created.id, message: "Medikament angelegt." };
}

// ── audit_timestamps ─────────────────────────────────────────────────────────
// Listet Attacken zur manuellen TZ-Prüfung. Da beim Erfassen nicht gespeichert
// wurde, ob ein Offset mitkam, lässt sich der 2-h-Bug nicht automatisch erkennen.
// Dieses Tool zeigt Onset-Zeit (Zurich) + UTC-Instant; unplausible Nacht-Onsets
// (00–05 Uhr) werden als verdächtig markiert. Korrektur erfolgt manuell über
// update_attack mit korrekter Lokalzeit.

export async function auditTimestamps(input: { limit?: number }) {
  const attacks = await prisma.attack.findMany({
    orderBy: { startedAt: "desc" },
    take: input.limit ?? 100,
  });
  return attacks.map((a) => {
    const hour = hourInZone(a.startedAt);
    return {
      id: a.id,
      startedAtZurich: formatDateTime(a.startedAt),
      startedAtUtc: a.startedAt.toISOString(),
      onsetHourZurich: hour,
      suspicious: hour >= 0 && hour <= 5, // unplausible Nacht-Onsets → prüfen
      notes: a.notes,
    };
  });
}
