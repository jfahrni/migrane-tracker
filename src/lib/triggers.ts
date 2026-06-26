export const TRIGGER_TAGS = [
  // Schlaf
  { slug: "schlechter_schlaf", label: "Schlechter Schlaf", category: "Schlaf" },
  { slug: "zu_wenig_schlaf", label: "Zu wenig Schlaf", category: "Schlaf" },
  { slug: "zu_viel_schlaf", label: "Zu viel Schlaf", category: "Schlaf" },
  { slug: "unregelmässiger_schlaf", label: "Unregelmässiger Schlaf", category: "Schlaf" },
  { slug: "jetlag", label: "Jetlag", category: "Schlaf" },
  // Stress & Psyche
  { slug: "stress", label: "Stress", category: "Stress" },
  { slug: "entspannung_nach_stress", label: "Entspannung nach Stress", category: "Stress" },
  { slug: "angst", label: "Angst/Anspannung", category: "Stress" },
  { slug: "erschöpfung", label: "Erschöpfung", category: "Stress" },
  // Hormonal
  { slug: "menstruation", label: "Menstruation", category: "Hormonal" },
  { slug: "ovulation", label: "Ovulation", category: "Hormonal" },
  { slug: "hormonelle_schwankung", label: "Hormonelle Schwankung", category: "Hormonal" },
  // Ernährung & Getränke
  { slug: "dehydration", label: "Dehydration", category: "Ernährung" },
  { slug: "hunger", label: "Hunger / ausgelassene Mahlzeit", category: "Ernährung" },
  { slug: "alkohol", label: "Alkohol", category: "Ernährung" },
  { slug: "rotwein", label: "Rotwein", category: "Ernährung" },
  { slug: "koffein_entzug", label: "Koffein-Entzug", category: "Ernährung" },
  { slug: "tyramin", label: "Tyramin (Käse, Schokolade)", category: "Ernährung" },
  { slug: "glutamat", label: "Glutamat/MSG", category: "Ernährung" },
  { slug: "schokolade", label: "Schokolade", category: "Ernährung" },
  // Wetter
  { slug: "wetterumschlag", label: "Wetterumschlag", category: "Wetter" },
  { slug: "föhn", label: "Föhn", category: "Wetter" },
  { slug: "hitze", label: "Hitze", category: "Wetter" },
  { slug: "kälte", label: "Kälte", category: "Wetter" },
  { slug: "luftdruckabfall", label: "Luftdruckabfall", category: "Wetter" },
  { slug: "temperaturwechsel", label: "Temperaturwechsel", category: "Wetter" },
  { slug: "zugluft", label: "Zugluft", category: "Wetter" },
  // Körper
  { slug: "nackenverspannung", label: "Nackenverspannung", category: "Körper" },
  { slug: "bruxismus", label: "Bruxismus / Zähneknirschen", category: "Körper" },
  { slug: "kieferprobleme", label: "Kieferprobleme", category: "Körper" },
  { slug: "augenanstrengung", label: "Augenanstrengung", category: "Körper" },
  { slug: "körperliche_anstrengung", label: "Körperliche Anstrengung", category: "Körper" },
  // Sinne & Umwelt
  { slug: "helles_licht", label: "Helles Licht / Blendung", category: "Sinne" },
  { slug: "bildschirm", label: "Langer Bildschirm", category: "Sinne" },
  { slug: "lärm", label: "Lärm", category: "Sinne" },
  { slug: "starke_gerüche", label: "Starke Gerüche", category: "Sinne" },
  { slug: "rauch", label: "Rauch", category: "Sinne" },
  // Rhythmus
  { slug: "unregelmässiger_rhythmus", label: "Unregelmässiger Tagesrhythmus", category: "Rhythmus" },
  // Sonstiges
  { slug: "unbekannt", label: "Unbekannt", category: "Sonstiges" },
] as const;

export type TriggerSlug = typeof TRIGGER_TAGS[number]["slug"];
export const TRIGGER_SLUGS = TRIGGER_TAGS.map((t) => t.slug);

export function triggerLabel(slug: string): string {
  return TRIGGER_TAGS.find((t) => t.slug === slug)?.label ?? slug;
}
