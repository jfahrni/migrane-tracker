import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { timingSafeEqual, createHash } from "crypto";
import { z } from "zod";
import {
  buildOverview,
  logAttackStart,
  logAttackEnd,
  updateAttack,
  listAttacks,
  getStatistics,
  listMedications,
  setMedication,
  auditTimestamps,
} from "@/lib/mcp";
import { verifyAccessToken } from "@/lib/oauth";
import { TRIGGER_TAGS } from "@/lib/triggers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

async function run<T>(label: string, fn: () => Promise<T>): Promise<ToolResult> {
  try {
    const data = await fn();
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  } catch (e) {
    return { content: [{ type: "text", text: `${label} failed: ${(e as Error).message}` }], isError: true };
  }
}

const TRIGGER_SLUGS = TRIGGER_TAGS.map((t) => t.slug);

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "get_overview",
      {
        title: "Übersicht abrufen",
        description:
          "Rufe dieses Tool am Anfang JEDER Unterhaltung auf — auch wenn der Nutzer über etwas ganz anderes spricht. " +
          "Gibt offene (nicht abgeschlossene) Attacken zurück, die noch kein endedAt haben. " +
          "Wenn openAttacks nicht leer ist, frage den Nutzer ZUERST, ob die Migräne noch andauert oder schon vorbei ist, " +
          "bevor du auf sein eigentliches Anliegen eingehst. " +
          "Enthält ausserdem Statistiken der letzten 30 Tage und die letzten 5 abgeschlossenen Attacken.",
        inputSchema: {},
      },
      () => run("get_overview", buildOverview),
    );

    server.registerTool(
      "log_attack_start",
      {
        title: "Attacke starten",
        description:
          "Erfasse den Beginn einer Migräne-Attacke. " +
          "Rufe dieses Tool auf, wenn der Nutzer erwähnt, dass er Migräne hat oder hatte. " +
          "\n\n" +
          "ANWEISUNG — FÜHRE EINE KURZE ANAMNESE WIE EIN NEUROLOGE. " +
          "Stelle gezielte Rückfragen, BEVOR du erfasst, damit die Daten auswertbar werden. " +
          "Frage NICHT alles auf einmal ab: stelle 1–3 Fragen pro Nachricht, beginne mit dem Wichtigsten, und überspringe alles, was der Nutzer schon gesagt hat. " +
          "Sei einfühlsam, nicht verhörend — bei einer akuten Attacke kurz halten, Details später nachholen. " +
          "Leite so viel wie möglich aus dem Freitext ab, statt es zu erfragen. " +
          "\n\n" +
          "Anamnese-Checkliste (Reihenfolge nach Wichtigkeit):\n" +
          "1. ZEITPUNKT: Wann genau hat es angefangen (Uhrzeit)? Bei rückwirkender Erfassung den Onset präzise festnageln — startedAt ohne Zeitzone wird als Europe/Zurich gewertet.\n" +
          "2. AURA vs. SCHMERZ (diese Migräne ist oft aura-zentriert): Kam zuerst eine Aura? Visuell (Flimmern, Zickzack, Gesichtsfeldausfall), sensorisch (Kribbeln/Taubheit), Sprache? Wie ausgeprägt (leicht/mittel/stark → auraSeverity 1–3)? → hasAura, auraType, auraSeverity.\n" +
          "3. KOPFSCHMERZ: Überhaupt Schmerz? Falls ja: Stärke 0–10, einseitig?, pulsierend/drückend?, schlimmer bei Bewegung? Falls reine Aura ohne Schmerz: intensity=0. → intensity.\n" +
          "4. BEGLEITSYMPTOME: Übelkeit/Erbrechen, Licht-/Lärm-/Geruchsempfindlichkeit? (in notes festhalten).\n" +
          "5. VORBOTEN (Prodrom, Stunden davor): Gähnen, Heißhunger, Stimmungs-/Energieänderung, Nackensteife? (in notes).\n" +
          "6. AUSLÖSER letzte 24–48 h: Schlaf (zu wenig/schlecht/unregelmäßig), Mahlzeit ausgelassen/Hunger, zu wenig getrunken, Stress ODER Entspannung danach, Hormonzyklus, Bildschirm, Alkohol, Wetter/Zugluft/Temperaturwechsel. → triggers (passende Slugs wählen; Mehrfachnennung ok).\n" +
          "7. MEDIKATION: Was genau, wann eingenommen, half es? → medications.\n" +
          "\n" +
          "Triggers dürfen als freier Text kommen — interpretiere die Aussagen und wähle passende Slugs aus der Tag-Bibliothek. " +
          "Wetterdaten werden automatisch abgerufen und relevante Wetter-Trigger automatisch ergänzt. " +
          "\n\n" +
          "WICHTIG: Lege IMMER eine kurze narrative Zusammenfassung im notes-Feld ab — in den eigenen Worten des Nutzers, verdichtet auf 1-2 Sätze. " +
          "Diese Notiz bewahrt den Kontext, den die strukturierten Tags verlieren (z.B. WARUM Stress, was genau am Bildschirm, welche Vorgeschichte, Begleitsymptome, Vorboten). " +
          "Beispiel: 'Flimmerskotom links ~20 Min, danach leichter Druck rechts (3/10). Gestern kurz geschlafen, morgens nüchtern. Eigene Einschätzung: Schlafmangel + Hunger.'",
        inputSchema: {
          intensity: z.number().int().min(0).max(10).optional().describe("Kopfschmerz-Intensität 0-10 (NRS), 0 = schmerzfrei (z.B. reine Aura)"),
          auraSeverity: z.number().int().min(1).max(3).optional().describe("Aura-Ausprägung 1-3 (1=leicht, 2=mittel, 3=stark) — unabhängig vom Schmerz"),
          hasAura: z.boolean().optional().describe("Hatte die Attacke eine Aura?"),
          auraType: z.enum(["visual", "sensory", "speech", "other"]).optional().describe("Art der Aura"),
          hadPostdrome: z.boolean().optional().describe("Postdrome / 'Matschbirne' nach der Attacke?"),
          postdromeNotes: z.string().optional().describe("Optionaler Freitext zur Postdrome"),
          triggers: z.array(z.string()).optional().describe(`Trigger-Tags aus der Bibliothek: ${TRIGGER_SLUGS.join(", ")}`),
          notes: z.string().optional().describe("Narrative Zusammenfassung in den Worten des Nutzers (1-2 Sätze) — bewahrt Kontext jenseits der Tags. IMMER ausfüllen."),
          medications: z.string().optional().describe("Eingenommene Medikamente"),
          startedAt: z.string().optional().describe("Datetime für rückwirkende Einträge. Naive Zeiten (ohne Offset) werden als Europe/Zurich interpretiert."),
          episodeGroupId: z.string().optional().describe("Optional: gemeinsame ID, um mehrere Schübe desselben Tages zu einer Episode zu gruppieren."),
        },
      },
      (args) => run("log_attack_start", () => logAttackStart(args)),
    );

    server.registerTool(
      "log_attack_end",
      {
        title: "Attacke abschliessen",
        description:
          "Markiere eine Migräne-Attacke als beendet und erfasse die Dauer. " +
          "Wenn kein attackId angegeben wird, wird die jüngste offene Attacke abgeschlossen. " +
          "endedAt ist optional (Standard: jetzt; naive Zeiten als Europe/Zurich). " +
          "Rufe dieses Tool auf, wenn der Nutzer sagt, dass es ihm besser geht oder die Migräne vorbei ist. " +
          "\n\n" +
          "ANWEISUNG — kurze Abschluss-Anamnese, 1–2 Fragen genügen:\n" +
          "1. WANN war es vorbei? (für endedAt / Dauer)\n" +
          "2. WAS HAT GEHOLFEN? Medikament (welches, wie schnell), Schlaf, Ruhe, Dunkelheit — narrativ in notes.\n" +
          "3. POSTDROME ('Matschbirne'): Fühlt sich der Nutzer danach benommen/erschöpft/'wie gerädert'? " +
          "Wenn ja → hadPostdrome=true (+ optional postdromeNotes). " +
          "Die Postdrome zeigt sich oft erst Stunden später — wenn unklar, kurz erwähnen, dass er sie später per update_attack nachtragen kann.",
        inputSchema: {
          attackId: z.string().optional().describe("ID der Attacke (optional — schliesst sonst die letzte offene)"),
          endedAt: z.string().optional().describe("Datetime des Endes (Standard: jetzt; naive Zeiten als Europe/Zurich)"),
          notes: z.string().optional().describe("Narrative Abschluss-Notiz: Verlauf und was geholfen hat. Wird an die Start-Notiz angehängt."),
          hadPostdrome: z.boolean().optional().describe("Postdrome / 'Matschbirne' nach der Attacke?"),
          postdromeNotes: z.string().optional().describe("Optionaler Freitext zur Postdrome"),
        },
      },
      (args) => run("log_attack_end", () => logAttackEnd(args)),
    );

    server.registerTool(
      "update_attack",
      {
        title: "Attacke korrigieren",
        description:
          "Aktualisiere oder korrigiere eine bereits erfasste Attacke. " +
          "Nützlich wenn der Nutzer nachträglich Informationen ergänzen oder korrigieren will.",
        inputSchema: {
          attackId: z.string().describe("ID der zu aktualisierenden Attacke"),
          intensity: z.number().int().min(0).max(10).optional().describe("Kopfschmerz 0-10 (0 = schmerzfrei)"),
          auraSeverity: z.number().int().min(1).max(3).optional().describe("Aura-Ausprägung 1-3"),
          hasAura: z.boolean().optional(),
          auraType: z.enum(["visual", "sensory", "speech", "other"]).optional(),
          hadPostdrome: z.boolean().optional(),
          postdromeNotes: z.string().optional(),
          triggers: z.array(z.string()).optional(),
          notes: z.string().optional(),
          medications: z.string().optional(),
          startedAt: z.string().optional().describe("Naive Zeiten werden als Europe/Zurich interpretiert."),
          endedAt: z.string().optional().describe("Naive Zeiten werden als Europe/Zurich interpretiert."),
          episodeGroupId: z.string().optional(),
        },
      },
      (args) => run("update_attack", () => updateAttack(args)),
    );

    server.registerTool(
      "list_attacks",
      {
        title: "Attacken auflisten",
        description: "Gibt eine Liste vergangener Attacken zurück, neueste zuerst.",
        inputSchema: {
          limit: z.number().int().min(1).max(100).optional().describe("Maximale Anzahl (Standard: 20)"),
          fromDate: z.string().optional().describe("Von-Datum (ISO-Format)"),
          toDate: z.string().optional().describe("Bis-Datum (ISO-Format)"),
        },
      },
      (args) => run("list_attacks", () => listAttacks(args)),
    );

    server.registerTool(
      "get_statistics",
      {
        title: "Statistiken abrufen",
        description:
          "Detaillierte Auswertung: monatliche Häufigkeit, Trigger-Verteilung, Intensitäts-Trend (inkl. schmerzfreier Auren), " +
          "Aura-Ausprägung, Postdrome-Häufigkeit, Tageszeit-Muster (Europe/Zurich), Wetter-Korrelation (Druck/Föhn aus persistierten Snapshots) " +
          "und Medikamenten-Vergleich (vorher/nachher, nur bei echter Baseline).",
        inputSchema: {
          months: z.number().int().min(1).max(24).optional().describe("Analysezeitraum in Monaten (Standard: 6)"),
        },
      },
      (args) => run("get_statistics", () => getStatistics(args)),
    );

    server.registerTool(
      "list_medications",
      {
        title: "Medikamente auflisten",
        description:
          "Listet erfasste Medikamenten-Phasen mit Startdatum und berechnetem 'Tag N' (für laufende Präparate). " +
          "Löst das alte CANDESARTAN_START_DATE aus der Env ab.",
        inputSchema: {},
      },
      () => run("list_medications", listMedications),
    );

    server.registerTool(
      "set_medication",
      {
        title: "Medikament anlegen/ändern",
        description:
          "Legt eine Medikamenten-Phase an oder aktualisiert sie. Ohne id wird ein neuer Eintrag erstellt (name + startedAt erforderlich). " +
          "Mit id werden nur die angegebenen Felder geändert. endedAt setzen, wenn ein Präparat abgesetzt wird.",
        inputSchema: {
          id: z.string().optional().describe("ID zum Aktualisieren (weglassen für neuen Eintrag)"),
          name: z.string().optional().describe("Präparatname, z.B. 'Candesartan'"),
          startedAt: z.string().optional().describe("Startdatum (naive Zeiten als Europe/Zurich)"),
          endedAt: z.string().optional().describe("Absetzdatum (optional)"),
          notes: z.string().optional(),
        },
      },
      (args) => run("set_medication", () => setMedication(args)),
    );

    server.registerTool(
      "audit_timestamps",
      {
        title: "Zeitstempel prüfen",
        description:
          "Listet Attacken zur manuellen Zeitzonen-Prüfung (Onset in Europe/Zurich + UTC-Instant). " +
          "Markiert unplausible Nacht-Onsets (00–05 Uhr) als 'suspicious'. " +
          "Hintergrund: Früher wurden naive Zeiten ohne Offset als UTC gespeichert (2 h zu spät). " +
          "Korrektur eines Eintrags erfolgt über update_attack mit der korrekten Lokalzeit.",
        inputSchema: {
          limit: z.number().int().min(1).max(500).optional().describe("Maximale Anzahl (Standard: 100)"),
        },
      },
      (args) => run("audit_timestamps", () => auditTimestamps(args)),
    );
  },
  {},
  { basePath: "/api", maxDuration: 60 },
);

function tokenMatches(token: string, expected: string): boolean {
  const a = createHash("sha256").update(token).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

const verifyToken = async (_req: Request, token?: string) => {
  if (!token) {
    console.error("[mcp/auth] no token provided");
    return undefined;
  }

  const oauthRecord = await verifyAccessToken(token);
  if (oauthRecord) {
    console.log("[mcp/auth] OAuth token OK, clientId:", oauthRecord.clientId);
    return { token, scopes: oauthRecord.scopes.split(" "), clientId: oauthRecord.clientId };
  }

  const expected = process.env.MCP_TOKEN;
  if (expected && tokenMatches(token, expected)) {
    console.log("[mcp/auth] static MCP_TOKEN OK");
    return { token, scopes: ["read"], clientId: "claude-desktop" };
  }

  console.error("[mcp/auth] token REJECTED, prefix:", token.slice(0, 10));
  return undefined;
};

const authHandler = withMcpAuth(handler, verifyToken, { required: true });

// ── String→Zahl/Bool-Coercion an der Transport-Grenze ────────────────────────
// Die MCP-Bridge übergibt numerische/boolesche Tool-Argumente oft als String
// ("0", "1", "true"). Statt das Zod-Schema tolerant zu machen (z.preprocess/
// z.coerce lösten im gebündelten Next-Build eine Endlos-Rekursion im
// zod-to-json-schema-Konverter aus → Stack Overflow), coercen wir hier den
// JSON-RPC-Body VOR der SDK-Validierung. Das Schema bleibt strikt und sicher.
const NUM_KEYS = new Set(["intensity", "auraSeverity", "limit", "months"]);
const BOOL_KEYS = new Set(["hasAura", "hadPostdrome"]);

function coerceArgs(args: Record<string, unknown>): void {
  for (const k of Object.keys(args)) {
    const v = args[k];
    if (typeof v !== "string") continue; // Bridge stringify't nur — Nicht-Strings unangetastet
    if (NUM_KEYS.has(k)) {
      if (v === "") { delete args[k]; continue; }
      const n = Number(v);
      if (Number.isFinite(n)) args[k] = n;
    } else if (BOOL_KEYS.has(k)) {
      if (v === "true" || v === "1") args[k] = true;
      else if (v === "false" || v === "0") args[k] = false;
    }
  }
}

/** Liest den JSON-RPC-Body, coerct tools/call-Argumente und baut den Request neu. */
async function coerceRequestBody(req: Request): Promise<Request> {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return req;

  let text: string;
  try { text = await req.text(); } catch { return req; }
  if (!text) return req;

  let coerced = text;
  try {
    const msg = JSON.parse(text);
    const args = msg?.params?.arguments;
    if (args && typeof args === "object" && !Array.isArray(args)) {
      coerceArgs(args as Record<string, unknown>);
      coerced = JSON.stringify(msg);
    }
  } catch {
    // Kein gültiges JSON → unverändert durchreichen (SDK behandelt den Fehler).
    return rebuildRequest(req, text);
  }

  return rebuildRequest(req, coerced);
}

function rebuildRequest(req: Request, body: string): Request {
  const headers = new Headers(req.headers);
  headers.delete("content-length"); // Body-Länge kann sich geändert haben
  return new Request(req.url, { method: req.method, headers, body });
}

function gated(h: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (process.env.ENABLE_MCP !== "true") return new Response("Not Found", { status: 404 });
    return h(req);
  };
}

export const GET = gated(authHandler);
export const POST = gated(async (req: Request) => authHandler(await coerceRequestBody(req)));
