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
          "Frage vorher nach: Intensität (1-10), Aura (ja/nein + Typ), mögliche Trigger. " +
          "Triggers dürfen als freier Text kommen — interpretiere die Aussagen des Nutzers und wähle passende Slugs aus der Tag-Bibliothek. " +
          "Wetterdaten werden automatisch abgerufen und relevante Wetter-Trigger automatisch ergänzt. " +
          "startedAt ist optional — wenn der Nutzer rückwirkend erfasst, frage nach dem genauen Zeitpunkt. " +
          "WICHTIG: Lege IMMER eine kurze narrative Zusammenfassung im notes-Feld ab — in den eigenen Worten des Nutzers, verdichtet auf 1-2 Sätze. " +
          "Diese Notiz bewahrt den Kontext, den die strukturierten Tags verlieren (z.B. WARUM Stress, was genau am Bildschirm, welche Vorgeschichte). " +
          "Beispiel: 'Starke Attacke morgens. Gestern langer Bildschirmtag, kaum getrunken. Eigene Einschätzung: Überanstrengung + Dehydration.'",
        inputSchema: {
          intensity: z.number().int().min(1).max(10).optional().describe("Schmerzintensität 1-10 (NRS)"),
          hasAura: z.boolean().optional().describe("Hatte die Attacke eine Aura?"),
          auraType: z.enum(["visual", "sensory", "speech", "other"]).optional().describe("Art der Aura"),
          triggers: z.array(z.string()).optional().describe(`Trigger-Tags aus der Bibliothek: ${TRIGGER_SLUGS.join(", ")}`),
          notes: z.string().optional().describe("Narrative Zusammenfassung in den Worten des Nutzers (1-2 Sätze) — bewahrt Kontext jenseits der Tags. IMMER ausfüllen."),
          medications: z.string().optional().describe("Eingenommene Medikamente"),
          startedAt: z.string().optional().describe("ISO-Datetime für rückwirkende Einträge"),
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
          "endedAt ist optional (Standard: jetzt). " +
          "Rufe dieses Tool auf, wenn der Nutzer sagt, dass es ihm besser geht oder die Migräne vorbei ist. " +
          "Frage kurz nach, was geholfen hat (Schlaf, Medikament, Ruhe) und halte das narrativ in notes fest.",
        inputSchema: {
          attackId: z.string().optional().describe("ID der Attacke (optional — schliesst sonst die letzte offene)"),
          endedAt: z.string().optional().describe("ISO-Datetime des Endes (Standard: jetzt)"),
          notes: z.string().optional().describe("Narrative Abschluss-Notiz: Verlauf und was geholfen hat. Wird an die Start-Notiz angehängt."),
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
          intensity: z.number().int().min(1).max(10).optional(),
          hasAura: z.boolean().optional(),
          auraType: z.enum(["visual", "sensory", "speech", "other"]).optional(),
          triggers: z.array(z.string()).optional(),
          notes: z.string().optional(),
          medications: z.string().optional(),
          startedAt: z.string().optional(),
          endedAt: z.string().optional(),
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
          "Detaillierte Auswertung: monatliche Häufigkeit, Trigger-Verteilung, Intensitäts-Trend, " +
          "Tageszeit-Muster und Candesartan-Vergleich (falls Startdatum konfiguriert).",
        inputSchema: {
          months: z.number().int().min(1).max(24).optional().describe("Analysezeitraum in Monaten (Standard: 6)"),
        },
      },
      (args) => run("get_statistics", () => getStatistics(args)),
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

function gated(h: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (process.env.ENABLE_MCP !== "true") return new Response("Not Found", { status: 404 });
    return h(req);
  };
}

export const GET = gated(authHandler);
export const POST = gated(authHandler);
