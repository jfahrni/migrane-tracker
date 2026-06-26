// Zeitzonen-Helfer für Europe/Zurich (inkl. DST).
//
// Hintergrund: Der Server läuft in UTC. `new Date("2026-06-26T21:15:00")`
// (naiver ISO-String OHNE Offset) wird von JS als UTC interpretiert und landet
// damit 2 h zu spät. Diese Helfer interpretieren naive Strings konsequent als
// Lokalzeit in Europe/Zurich, lassen Strings MIT Offset (`Z` oder ±hh:mm)
// aber unangetastet.

export const APP_TZ = "Europe/Zurich";

// Offset (Lokalzeit − UTC) in Millisekunden für einen gegebenen UTC-Instant.
function tzOffsetMs(utcMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const hour = map.hour === "24" ? "00" : map.hour;
  const asUtcOfLocal = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(hour),
    Number(map.minute),
    Number(map.second),
  );
  return asUtcOfLocal - utcMs;
}

// Interpretiert Wand-Uhrzeit-Komponenten als Europe/Zurich und liefert den
// korrekten UTC-Instant (DST-korrekt, inkl. einmaliger Verfeinerung an der
// Sommer-/Winterzeit-Grenze).
function zonedToUtc(
  y: number, mo: number, d: number,
  h: number, mi: number, s: number,
  tz: string,
): Date {
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  const offset = tzOffsetMs(asUtc, tz);
  let utc = asUtc - offset;
  const offset2 = tzOffsetMs(utc, tz);
  if (offset2 !== offset) utc = asUtc - offset2;
  return new Date(utc);
}

const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/;
const NAIVE_DT =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

// Parst einen Datetime-String zu einem absoluten Instant.
//  - mit Offset (`...Z`, `...+02:00`) → unverändert via `new Date`
//  - naiv (`2026-06-26T21:15` oder `2026-06-26`) → als Europe/Zurich
export function parseLocalToInstant(input: string): Date {
  if (HAS_OFFSET.test(input.trim())) {
    return new Date(input);
  }
  const m = NAIVE_DT.exec(input.trim());
  if (!m) {
    // Unbekanntes Format: konservativer Fallback auf native Parsing.
    return new Date(input);
  }
  const [, y, mo, d, h = "0", mi = "0", s = "0"] = m;
  return zonedToUtc(
    Number(y), Number(mo), Number(d),
    Number(h), Number(mi), Number(s),
    APP_TZ,
  );
}

// Stunde (0–23) eines Instants in Europe/Zurich — für Tageszeit-Auswertungen.
export function hourInZone(d: Date, tz: string = APP_TZ): number {
  const hh = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    hour12: false,
  }).format(d);
  const h = Number(hh);
  return h === 24 ? 0 : h;
}
