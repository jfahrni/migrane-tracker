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
  listHistory,
  upsertHistory,
  deleteHistory,
  setStandingInstructions,
  getStandingInstructions,
  HISTORY_TYPES,
  DATE_PRECISIONS,
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

function registerTools(server: Parameters<Parameters<typeof createMcpHandler>[0]>[0]) {
  {
    server.registerTool(
      "get_overview",
      {
        title: "Übersicht abrufen",
        description:
          "Rufe dieses Tool am Anfang JEDER Unterhaltung auf — auch wenn der Nutzer über etwas ganz anderes spricht. " +
          "Gibt offene (nicht abgeschlossene) Attacken zurück, die noch kein endedAt haben. " +
          "Wenn openAttacks nicht leer ist, frage den Nutzer ZUERST, ob die Migräne noch andauert oder schon vorbei ist, " +
          "bevor du auf sein eigentliches Anliegen eingehst. " +
          "Enthält ausserdem Statistiken der letzten 30 Tage und die letzten 5 abgeschlossenen Attacken. " +
          "\n\n" +
          "patientHistory enthält die Vorgeschichte (Vorbefunde, Bildgebung, relevante Ereignisse wie eine " +
          "TGA-Episode, Komorbiditäten). LIES SIE, bevor du Attacken-Daten interpretierst — ohne diesen " +
          "klinischen Kontext lassen sich Muster und Trends leicht fehldeuten.",
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
          episodeGroupId: z.string().optional().describe("Optional: gemeinsame ID, um mehrere Schübe desselben Tages zu einer Episode zu gruppieren. Attacken sind nicht löschbar — nutze dies (oder update_attack), statt einen Fehleintrag durch einen neuen zu ersetzen."),
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
          "Nützlich wenn der Nutzer nachträglich Informationen ergänzen oder korrigieren will. " +
          "\n\n" +
          "WICHTIG: Attacken lassen sich NICHT löschen. Dieses Tool ist der einzige Weg, einen " +
          "Fehleintrag zu berichtigen — lege niemals einen Ersatz-Eintrag an, das würde die Statistik " +
          "verfälschen (die Attacke zählt sonst doppelt).\n" +
          "Wurde etwas versehentlich als eigenständige Attacke erfasst, obwohl es zu einer anderen " +
          "gehört (z.B. Nachwehen desselben Tages), fasse beide über eine gemeinsame `episodeGroupId` " +
          "zu einer Episode zusammen und halte den Sachverhalt in `notes` fest.",
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
          "Mit id werden nur die angegebenen Felder geändert. endedAt setzen, wenn ein Präparat abgesetzt wird. " +
          "\n\n" +
          "DATIERUNG: Ist das Startdatum nur ungefähr bekannt (z.B. 'seit etwa 2020'), setze startPrecision=YEAR " +
          "und startApproximate=true. Die Ausgabe wird dann als 'ca. 2020' gekennzeichnet und 'Tag N' wird " +
          "unterdrückt. Ohne das sieht ein hingeschriebenes 01.01.2020 später wie ein belegter Fakt aus.",
        inputSchema: {
          id: z.string().optional().describe("ID zum Aktualisieren (weglassen für neuen Eintrag)"),
          name: z.string().optional().describe("Präparatname, z.B. 'Candesartan'"),
          startedAt: z.string().optional().describe("Startdatum (naive Zeiten als Europe/Zurich)"),
          startPrecision: z.enum(DATE_PRECISIONS).optional().describe("Genauigkeit des Startdatums: YEAR | MONTH | DAY"),
          startApproximate: z.boolean().optional().describe("true = Startdatum ist geschätzt (Ausgabe als 'ca. …', kein dayNumber)"),
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

    server.registerTool(
      "list_history",
      {
        title: "Anamnese auflisten",
        description:
          "Listet die Vorgeschichte. Wird auch von get_overview mitgeliefert — dieses Tool ist für " +
          "gezielte Abfragen oder zum Filtern nach Typ.",
        inputSchema: {
          type: z.enum(HISTORY_TYPES).optional().describe("Nach Typ filtern. Weglassen für alle."),
        },
      },
      (args) => run("list_history", () => listHistory(args)),
    );

    server.registerTool(
      "upsert_history",
      {
        title: "Anamnese-Eintrag anlegen/ändern",
        description:
          "Legt einen Eintrag zur Vorgeschichte an oder aktualisiert ihn. Ohne id wird ein neuer Eintrag " +
          "erstellt (type + title erforderlich); mit id werden nur die angegebenen Felder geändert. " +
          "\n\n" +
          "TYPEN — wähle den passenden, denn der Typ entscheidet, ob und wie ein Eintrag ausgewertet wird:\n" +
          "- ONSET: wann/wie die Migräne überhaupt begann\n" +
          "- PRIOR_PATTERN: wie sie früher verlief (Frequenz, Charakter vor der jetzigen Phase)\n" +
          "- IMAGING: Bildgebung inkl. Befund (MRT, CT)\n" +
          "- DIAGNOSIS: gestellte Diagnosen\n" +
          "- COMORBID_EVENT: relevante Ereignisse/Begleiterkrankungen (z.B. eine TGA-Episode)\n" +
          "- MEDICATION_PAST: frühere Medikation\n" +
          "- FAMILY: Familienanamnese\n" +
          "- CARE_CONTEXT: Behandlungskontext (wer behandelt, nächster Termin)\n" +
          "- OTHER: alles andere\n" +
          "\n" +
          "DATIERUNG — erzwinge KEIN exaktes Datum. Nutze occurredAt zusammen mit precision und approximate:\n" +
          "- Genau bekannter Tag → occurredAt + precision=DAY, approximate=false\n" +
          "- Nur Monat bekannt → occurredAt (1. des Monats) + precision=MONTH\n" +
          "- Nur Jahr bekannt → occurredAt (1. Januar) + precision=YEAR\n" +
          "- Geschätzt/unsicher → zusätzlich approximate=true (Ausgabe wird dann als 'ca. …' gekennzeichnet)\n" +
          "- Zeitpunkt völlig unbekannt → occurredAt weglassen\n" +
          "Ohne precision/approximate sieht eine Näherung später wie ein belegter Fakt aus. Das wäre " +
          "Scheinpräzision und schlechtere Medizin.",
        inputSchema: {
          id: z.string().optional().describe("ID zum Aktualisieren (weglassen für neuen Eintrag)"),
          type: z.enum(HISTORY_TYPES).optional().describe("Typ des Eintrags (siehe Beschreibung)"),
          title: z.string().optional().describe("Kurzer Titel, z.B. 'MRT Schädel' oder 'TGA-Episode'"),
          detail: z.string().optional().describe("Befund, Verlauf, klinischer Kontext"),
          occurredAt: z.string().optional().describe("Datum, nur wenn bekannt (naive Zeiten als Europe/Zurich)"),
          precision: z.enum(DATE_PRECISIONS).optional().describe("Genauigkeit von occurredAt: YEAR | MONTH | DAY"),
          approximate: z.boolean().optional().describe("true = Datum ist geschätzt, nicht belegt (Ausgabe als 'ca. …')"),
        },
      },
      (args) => run("upsert_history", () => upsertHistory(args)),
    );

    server.registerTool(
      "set_standing_instructions",
      {
        title: "Dauerhafte Anweisungen setzen",
        description:
          "Setzt dauerhafte Anweisungen, die bei JEDEM get_overview ganz oben in clinicalBriefing.readFirst " +
          "ausgeliefert werden — sitzungsübergreifend und verbindlich. " +
          "Nutze dies für Regeln, die immer gelten sollen, z.B. 'Vor Abklärungsempfehlungen nachfragen' oder " +
          "'Hausarzt kennt die Vorgeschichte, Termin Anfang August'. Der Text ersetzt die bisherigen Anweisungen.",
        inputSchema: {
          text: z.string().describe("Der vollständige Anweisungstext (ersetzt den bisherigen)"),
        },
      },
      (args) => run("set_standing_instructions", () => setStandingInstructions(args)),
    );

    server.registerTool(
      "delete_history",
      {
        title: "Anamnese-Eintrag löschen",
        description:
          "Löscht einen Eintrag der Vorgeschichte anhand seiner id. Nutze dies, um versehentlich " +
          "angelegte oder doppelte Einträge zu entfernen. Attacken lassen sich damit NICHT löschen.",
        inputSchema: {
          id: z.string().describe("ID des zu löschenden Anamnese-Eintrags"),
        },
      },
      (args) => run("delete_history", () => deleteHistory(args)),
    );
  }
}

// ── Server-Instructions (beim initialize ausgeliefert) ───────────────────────
// Drei Teile, analog zum Chastity-Tracker:
//  1. Befehlsliste / Tool-Wahl — damit die Befehlsfläche ohne Raten klar ist.
//  2. Zeiger auf das Pflicht-Briefing (der frische Stand steht in get_overview).
//  3. Wörtliches Abbild der dauerhaften Anweisungen (Stand beim Server-Start).

const MCP_SERVER_INSTRUCTIONS =
  "Migräne-Tracker MCP. Erfasst Attacken, Medikamentenphasen und die Krankengeschichte.\n\n" +
  "BEFEHLE / Tool-Wahl:\n" +
  "• IMMER ZUERST → `get_overview`: offene Attacken, `clinicalBriefing` (Pflichtlektüre), " +
  "`patientHistory` (Vorgeschichte), 30-Tage-Statistik, aktuelle Medikation.\n" +
  "• ERFASSEN → `log_attack_start` (Onset; führe dabei eine kurze Anamnese wie ein Neurologe), " +
  "`log_attack_end` (Abschluss: Dauer + was geholfen hat + Postdrome), " +
  "`update_attack` (Korrektur/Nachtrag an einer bestehenden Attacke).\n" +
  "• AUSWERTEN → `list_attacks` (Rohliste), `get_statistics` (Frequenz, Trigger, Tageszeit, " +
  "Medikamenten-Vergleich), `audit_timestamps` (Zeitzonen-Prüfung verdächtiger Nacht-Onsets).\n" +
  "• VORGESCHICHTE → `list_history` (nach Typ filterbar), `upsert_history` (anlegen/ändern, " +
  "typisiert: ONSET, PRIOR_PATTERN, IMAGING, DIAGNOSIS, COMORBID_EVENT, MEDICATION_PAST, FAMILY, " +
  "CARE_CONTEXT, OTHER), `delete_history` (Fehleinträge entfernen).\n" +
  "• MEDIKATION → `list_medications`, `set_medication` (Phasen anlegen/absetzen).\n" +
  "• REGELN → `set_standing_instructions`: dauerhafte Anweisungen des Nutzers; sie erscheinen " +
  "danach in `get_overview.clinicalBriefing.readFirst`.\n\n" +
  "Attacken lassen sich NICHT löschen — Fehleinträge werden per `update_attack` korrigiert oder " +
  "über `episodeGroupId` zusammengefasst. Nur Anamnese-Einträge sind löschbar.\n\n" +
  "DATIERUNG: Angaben mit vorangestelltem 'ca.' sind Näherungen, keine belegten Daten. Behandle sie " +
  "niemals als Fakten und leite daraus keine exakten Zeiträume oder Tageszählungen ab. Beim Erfassen " +
  "unscharfer Zeitpunkte `precision` (YEAR|MONTH|DAY) und `approximate=true` setzen, statt ein Datum " +
  "hinzubiegen.\n\n" +
  "Das Datenfenster von `get_overview` ist kurz (30 Tage); die Krankengeschichte reicht deutlich " +
  "weiter zurück. Ein Trend im Fenster ist kein Trend der Erkrankung.";

const BRIEFING_POINTER =
  "\n\nVERBINDLICHES BRIEFING: Rufe `get_overview` am Anfang JEDER Unterhaltung auf und lies " +
  "`clinicalBriefing.readFirst` ZUERST — es steht als erstes Feld in der Antwort und nennt die " +
  "Grenzen der Daten sowie die dauerhaften Anweisungen des Nutzers. Immer frisch von dort lesen, " +
  "da sie sich jederzeit ändern können. Interpretiere KEINE Attacken-Daten, bevor du es gelesen hast.";

/** Basis + Zeiger + (best effort) wörtliches Abbild der aktuellen dauerhaften Anweisungen.
 *  Das Abbild spiegelt den Stand beim Server-START (Refresh erst bei Deploy/Neustart) — der
 *  maßgebliche, frische Wert bleibt clinicalBriefing (siehe Zeiger). DB-Zugriff nur zur Laufzeit
 *  unter nodejs, nie zur Build-/Edge-Zeit. */
async function buildServerInstructions(): Promise<string> {
  let instructions = MCP_SERVER_INSTRUCTIONS + BRIEFING_POINTER;
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const standing = await getStandingInstructions();
      if (standing) {
        instructions +=
          "\n\nAKTUELLE DAUERHAFTE ANWEISUNGEN (Abbild beim Server-Start — der frische Stand bleibt " +
          "get_overview.clinicalBriefing.standingInstructions):\n" + standing;
      }
    } catch {
      // best effort: fehlende DB darf den MCP-Endpoint nicht blockieren
    }
  }
  return instructions;
}

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

  // DB-Fehler (z.B. kurzer SQLite-Lock, connection_limit=1) dürfen NICHT durchschlagen:
  // eine geworfene Exception liefert dem Client eine leere Antwort statt eines sauberen
  // 401 — der Client hält den Server dann für kaputt. Statisches Token bleibt als Fallback.
  let oauthRecord: Awaited<ReturnType<typeof verifyAccessToken>> = null;
  try {
    oauthRecord = await verifyAccessToken(token);
  } catch (e) {
    console.error("[mcp/auth] OAuth-Token-Prüfung fehlgeschlagen (DB?):", (e as Error).message);
  }
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

async function buildAuthHandler(): Promise<(req: Request) => Promise<Response>> {
  const instructions = await buildServerInstructions();
  const handler = createMcpHandler(registerTools, { instructions }, { basePath: "/api", maxDuration: 60 });
  return withMcpAuth(handler, verifyToken, { required: true });
}

/** Memoisiert: einmal beim ersten Request gebaut. Die Instructions (inkl. eingebettetem Abbild der
 *  dauerhaften Anweisungen) entsprechen dem Stand beim Server-Start; Refresh bei Deploy/Neustart.
 *
 *  WICHTIG: Bei einem Fehler wird die Memoisierung zurückgesetzt. Sonst bliebe eine einmal
 *  abgelehnte Promise für immer gecacht und JEDER weitere Request schlüge fehl — der Endpoint
 *  wäre bis zum nächsten Neustart tot, ohne dass sich am Code etwas geändert hätte. */
let authHandlerPromise: Promise<(req: Request) => Promise<Response>> | null = null;
function getAuthHandler(): Promise<(req: Request) => Promise<Response>> {
  if (!authHandlerPromise) {
    authHandlerPromise = buildAuthHandler().catch((e) => {
      authHandlerPromise = null; // nächster Request baut neu auf
      throw e;
    });
  }
  return authHandlerPromise;
}

// ── String→Zahl/Bool-Coercion an der Transport-Grenze ────────────────────────
// Die MCP-Bridge übergibt numerische/boolesche Tool-Argumente oft als String
// ("0", "1", "true"). Statt das Zod-Schema tolerant zu machen (z.preprocess/
// z.coerce lösten im gebündelten Next-Build eine Endlos-Rekursion im
// zod-to-json-schema-Konverter aus → Stack Overflow), coercen wir hier den
// JSON-RPC-Body VOR der SDK-Validierung. Das Schema bleibt strikt und sicher.
const NUM_KEYS = new Set(["intensity", "auraSeverity", "limit", "months"]);
const BOOL_KEYS = new Set(["hasAura", "hadPostdrome", "approximate", "startApproximate"]);
const ARRAY_KEYS = new Set(["triggers"]);

/** Wandelt einen von der Bridge stringifizierten Array-Wert in ein echtes Array.
 *  Deckt beide Formen ab: JSON-String ('["a","b"]') und einzeln/kommagetrennt ("a,b"). */
function toStringArray(v: string): string[] {
  const t = v.trim();
  if (t === "") return [];
  if (t.startsWith("[")) {
    try {
      const parsed = JSON.parse(t);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch { /* fällt unten auf Komma-Split zurück */ }
  }
  return t.split(",").map((s) => s.trim()).filter(Boolean);
}

function coerceArgs(args: Record<string, unknown>): void {
  for (const k of Object.keys(args)) {
    const v = args[k];
    if (typeof v !== "string") continue; // Bridge stringify't nur — echte Arrays/Zahlen unangetastet
    if (NUM_KEYS.has(k)) {
      if (v === "") { delete args[k]; continue; }
      const n = Number(v);
      if (Number.isFinite(n)) args[k] = n;
    } else if (BOOL_KEYS.has(k)) {
      if (v === "true" || v === "1") args[k] = true;
      else if (v === "false" || v === "0") args[k] = false;
    } else if (ARRAY_KEYS.has(k)) {
      args[k] = toStringArray(v);
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
    console.log(`[MCP-REQ] method=${msg?.method ?? "?"} id=${msg?.id ?? "-"} accept=${req.headers.get("accept") ?? "-"} session=${req.headers.get("mcp-session-id") ?? "-"}`);
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

// CORS für Browser-basierte MCP-Clients (claude.ai Web + Desktop-App, die die
// Web-Schicht einbettet). Ohne diese Header auf der ECHTEN Antwort (nicht nur im
// Preflight) verwirft der Browser die Response — die native Mobile-App ist davon
// nicht betroffen. Deshalb: Mobile geht, Web/Desktop nicht.
const MCP_CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, WWW-Authenticate",
};

/** Injiziert die CORS-Header in die (ggf. gestreamte) Antwort des Handlers.
 *  new Response(res.body, …) erhält den ReadableStream, sodass SSE weiter fliesst. */
function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(MCP_CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/** Ruft den Handler auf und loggt die Antwort (Status, Content-Type, Session-ID, ob gestreamt).
 *  So sehen wir, was claude.ai's Backend tatsächlich zurückbekommt. */
async function runMcp(handlerReq: Request, httpMethod: string): Promise<Response> {
  const t0 = Date.now();
  const res = await (await getAuthHandler())(handlerReq);
  console.log(
    `[MCP-RESP] ${httpMethod} → ${res.status} ct=${res.headers.get("content-type") ?? "-"} ` +
    `session=${res.headers.get("mcp-session-id") ?? "-"} stream=${res.body != null} (${Date.now() - t0}ms)`,
  );
  return withCors(res);
}

export const GET = gated(async (req: Request) => runMcp(req, "GET"));
export const POST = gated(async (req: Request) => runMcp(await coerceRequestBody(req), "POST"));

/** Streamable HTTP beendet Sessions per DELETE. Ohne Handler antwortet Next mit 405 und der
 *  Client behält eine Zombie-Session, statt sauber neu aufzubauen. */
export const DELETE = gated(async (req: Request) => runMcp(req, "DELETE"));

/** Preflight — darf NICHT hinter der Bearer-Auth liegen, sonst scheitert er mit 401. */
export async function OPTIONS(): Promise<Response> {
  if (process.env.ENABLE_MCP !== "true") return new Response("Not Found", { status: 404 });
  return new Response(null, { status: 204, headers: MCP_CORS });
}
