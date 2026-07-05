# Bug-Report: MCP-Tools lehnen numerische & boolesche Felder ab — und der naheliegende Zod-Fix crasht den Server

**Stand:** 2026-07-05
**Komponente:** Migränetracker MCP-Server (`migraene.fahrni.ch/api/mcp`)
**Stack:** Next.js 16 (standalone) · `mcp-handler` · `@modelcontextprotocol/sdk` 1.26 · Zod 4 · Docker
**Client:** Claude (MCP-Bridge, Desktop + Mobile)
**Status:** ✅ **behoben** (Commit `78729f3`, deployed & end-to-end verifiziert)
**Schweregrad:** Hoch — betraf die Kernfunktion (strukturierte Erfassung)

---

## 1. Zusammenfassung

Die MCP-Bridge übergibt **numerische und boolesche Tool-Argumente als String** (`"0"`,
`"1"`, `"true"`). Das serverseitige Zod-Schema erwartete strikte Typen (`z.number()` /
`z.boolean()`), coerct nicht, und lehnte den **gesamten** Request mit `invalid_type` ab.

Der **naheliegende Fix** — Coercion direkt im Zod-Schema (`z.coerce` / `z.preprocess`) —
ist **eine Falle**: Er bringt im gebündelten Next-Build den **gesamten MCP-Endpoint zum
Absturz** (`RangeError: Maximum call stack size exceeded`) und liefert *null* Tools aus.
Lokal ist das **nicht reproduzierbar**.

Die tragfähige Lösung coerct die Werte **an der Transport-Grenze** (im JSON-RPC-Body,
vor der SDK-Validierung) und lässt das Zod-Schema **strikt und unangetastet**.

---

## 2. Betroffene Tools & Felder

| Tool | Felder |
|------|--------|
| `log_attack_start` | `intensity`, `auraSeverity`, `hasAura`, `hadPostdrome` |
| `log_attack_end` | `hadPostdrome` |
| `update_attack` | `intensity`, `auraSeverity`, `hasAura`, `hadPostdrome` |
| `list_attacks` | `limit` |
| `get_statistics` | `months` |

**Funktioniert korrekt** (alles Strings): `notes`, `auraType`, `postdromeNotes`,
`startedAt`, `endedAt`, `triggers`.

---

## 3. Symptom A — Validierung lehnt Strings ab (Ausgangsbug)

```
MCP error -32602: Input validation error: Invalid arguments for tool log_attack_start: [
  { "expected": "number",  "code": "invalid_type", "path": ["intensity"],
    "message": "Invalid input: expected number, received string" },
  { "expected": "number",  "code": "invalid_type", "path": ["auraSeverity"],
    "message": "Invalid input: expected number, received string" },
  { "expected": "boolean", "code": "invalid_type", "path": ["hasAura"],
    "message": "Invalid input: expected boolean, received string" }
]
```

Der Request wird **komplett** verworfen. Nur Aufrufe rein mit String-Feldern gehen durch.

### Reproduktion
1. `log_attack_start` mit `hasAura=true`, `auraSeverity=1`, `intensity=0`.
2. → `-32602`, alle drei Felder `invalid_type`.
3. Deterministisch.

---

## 4. Symptom B — der Zod-Fix crasht den Endpoint (die eigentliche Falle)

Der intuitive Fix lautet „mach das Schema tolerant" mit `z.coerce` bzw. `z.preprocess`:

```ts
// ⚠️  BRINGT DEN SERVER ZUM ABSTURZ — nicht verwenden
intensity: z.coerce.number().int().min(0).max(10).optional(),
hasAura:   z.preprocess(v => v === "true" ? true : v, z.boolean()).optional(),
```

Nach dem Deploy **crasht dann jeder MCP-Request** (`initialize`, `tools/list`,
`tools/call`) mit:

```
⨯ unhandledRejection:  RangeError: Maximum call stack size exceeded
    at hA (.next/server/chunks/[root-of-the-server]__…_.js:89:174768)
    at hA (.next/server/chunks/[root-of-the-server]__…_.js:89:174768)
    at hA (…)   ← Endlos-Rekursion
```

Der HTTP-Server bleibt oben (die HTML-Startseite lädt), aber der MCP-Endpoint
antwortet nicht mehr — die Bridge sieht eine **leere/tote Tool-Liste** und meldet
„integration not available" bzw. „Verbindung fehlgeschlagen".

### Warum (Ursache des Crashes)

`@modelcontextprotocol/sdk` wählt seinen JSON-Schema-Konverter zur Laufzeit:

```ts
// zod-compat.js (SDK)
function isZ4Schema(s) { return !!s._zod; }   // v4 erkannt?  → z4mini.toJSONSchema
                                              // sonst        → zod-to-json-schema (v3)
```

Im **gebündelten** Next-Standalone-Build greift diese `_zod`-Erkennung bei
`z.coerce`/`z.preprocess`-Knoten **nicht zuverlässig**. Das Schema fällt auf den alten
**`zod-to-json-schema` (v3)**-Konverter zurück — der auf den **v4-internen** Strukturen
(`ZodPipe` / `ZodTransform`) **endlos rekursiert** → Stack Overflow beim Aufbau der
Tool-Schemas (also schon im `tools/list`-/Capability-Pfad).

**Lokal nicht reproduzierbar:** Unbundled (Node direkt) greift die v4-Erkennung korrekt,
der v4-Konverter verarbeitet dieselben Schemas fehlerfrei. Der Crash tritt **nur** im
Docker-/Standalone-Build auf.

---

## 5. Zwei Zod-Fallstricke, die man kennen muss

### Fallstrick 1 — `z.coerce.boolean()` ist semantisch kaputt
```ts
z.coerce.boolean().parse("false")   // → true  (!)   Boolean("false") === true
```
Jedes `hasAura=false` würde **still zu `true` kippen** — verfälschte Daten **ohne**
Fehler. Niemals `z.coerce.boolean()` für „true"/"false"-Strings verwenden.

### Fallstrick 2 — `z.coerce` / `z.preprocess` im Tool-`inputSchema`
Siehe §4: crasht den gebündelten Build. **Kein** `z.coerce`, **kein** `z.preprocess`
in einem MCP-Tool-Schema.

---

## 6. Lösung (umgesetzt) — Coercion an der Transport-Grenze

Das Zod-Schema bleibt **strikt** (`z.number()` / `z.boolean()` — nachweislich
crash-frei). Die String→Zahl/Bool-Umwandlung passiert **davor**, im rohen JSON-RPC-Body,
bevor die SDK-Validierung läuft.

```ts
// src/app/api/[transport]/route.ts

const NUM_KEYS  = new Set(["intensity", "auraSeverity", "limit", "months"]);
const BOOL_KEYS = new Set(["hasAura", "hadPostdrome"]);

function coerceArgs(args: Record<string, unknown>): void {
  for (const k of Object.keys(args)) {
    const v = args[k];
    if (typeof v === "string" && NUM_KEYS.has(k)) {
      if (v === "") { delete args[k]; continue; }      // "" → weglassen, nicht 0
      const n = Number(v);
      if (Number.isFinite(n)) args[k] = n;
    } else if (typeof v === "string" && BOOL_KEYS.has(k)) {
      // Explizit — NICHT z.coerce.boolean() (Boolean("false") === true)
      if (v === "true"  || v === "1") args[k] = true;
      else if (v === "false" || v === "0") args[k] = false;
    }
  }
}

/** Liest den JSON-RPC-Body, coerct tools/call-Argumente, baut den Request neu. */
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
    return rebuildRequest(req, text);   // kein JSON → unverändert, SDK meldet den Fehler
  }
  return rebuildRequest(req, coerced);
}

function rebuildRequest(req: Request, body: string): Request {
  const headers = new Headers(req.headers);
  headers.delete("content-length");     // Body-Länge kann sich geändert haben
  return new Request(req.url, { method: req.method, headers, body });
}

export const POST = gated(async (req) => authHandler(await coerceRequestBody(req)));
```

**Vorteile**
- Zod-Schema bleibt strikt → **kein** Konverter-Crash, JSON-Schema bleibt sauber typisiert.
- Range-Prüfung (`.min()/.max()/.int()`) greift weiter — ungültige Werte werden weiter
  laut abgelehnt, nicht still verbogen.
- Entkoppelt von der Bridge (die man nicht anfassen kann); ein zentraler Ort statt N
  Schema-Anpassungen.

### Warum nicht in der Bridge fixen?
Die Bridge stringify't die Argumente (Ursprung des Problems), steht aber nicht unter
eigener Kontrolle. Der Fix gehört daher **serverseitig** hin.

---

## 7. Verifikation

| Test | Ergebnis |
|------|----------|
| `initialize` (SSE) | ✅ antwortet sofort |
| `tools/list` | ✅ liefert alle Tools (kein Stack Overflow) |
| `update_attack` mit `intensity`/`hasAura` als String über die Bridge | ✅ gespeichert als `intensity: 2` (number), `hasAura: false` (boolean) |

---

## 8. Zusätzlich mitgefixt

**Wetter-Fetch ohne Timeout** (`src/lib/weather.ts`): `fetchWeather()` hatte kein
Timeout. Sobald die Coercion Requests bis zum Wetter-Call durchließ und open-meteo
langsam/nicht erreichbar war, blockierte der Tool-Call unbegrenzt und staute bei
Retries den Server. Behoben mit hartem 4-s-`AbortController`; Wetter ist optional
(bei Timeout/Fehler wird ohne Wetter erfasst).

---

## 9. Nachtrag (erledigt)

Der eine reale Datensatz am Workaround wurde nach dem Deploy strukturiert nachgezogen:

- **Nacht-Eintrag 30.06.→01.07.** (`id: cmr802aqt000d69edu3usuxjy`):
  `intensity = 2`, `hasAura = false` ✅ gesetzt.

---

## 10. Lessons Learned

1. Bei `mcp-handler` + Zod v4 im **gebündelten** Next-Build **niemals** `z.coerce` /
   `z.preprocess` in ein Tool-`inputSchema` — das crasht die Schema-Serialisierung
   (`isZ4Schema`-Fehlerkennung → v3-Konverter → Endlos-Rekursion). Lokal unauffällig.
2. `z.coerce.boolean()` ist für „true"/"false"-Strings **immer falsch**
   (`Boolean("false") === true`).
3. Typ-Coercion für MCP-Tools gehört an die **Transport-Grenze** (JSON-RPC-Body),
   nicht ins Schema.
4. Externe Fetches in Tool-Pfaden **immer** mit Timeout — ein hängender Fetch bei
   Retries sättigt den Server und sieht aus wie „Server down".
