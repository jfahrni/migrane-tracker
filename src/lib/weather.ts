export interface WeatherSnapshot {
  fetchedAt: string;
  temperature: number;
  humidity: number;
  pressure: number;
  pressureDelta3h: number | null; // negative = falling
  windSpeed: number;
  windDirection: number;
  weatherDescription: string;
  isFoehnLikely: boolean;
  isPressureTrigger: boolean; // drop > 5 hPa in 3h
}

const WMO_DESCRIPTIONS: Record<number, string> = {
  0: "Klar", 1: "Überwiegend klar", 2: "Teilweise bewölkt", 3: "Bedeckt",
  45: "Nebel", 48: "Gefrierender Nebel",
  51: "Leichter Nieselregen", 53: "Nieselregen", 55: "Starker Nieselregen",
  61: "Leichter Regen", 63: "Regen", 65: "Starker Regen",
  71: "Leichter Schneefall", 73: "Schneefall", 75: "Starker Schneefall",
  80: "Leichte Schauer", 81: "Schauer", 82: "Starke Schauer",
  95: "Gewitter", 96: "Gewitter mit Hagel", 99: "Gewitter mit starkem Hagel",
};

export async function fetchWeather(): Promise<WeatherSnapshot | null> {
  const lat = process.env.WEATHER_LAT ?? "47.6958";
  const lon = process.env.WEATHER_LON ?? "8.6353";

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,wind_direction_10m,weather_code` +
      `&hourly=surface_pressure` +
      `&past_hours=4&forecast_hours=0` +
      `&timezone=Europe%2FZurich`;

    // Hartes Timeout: Wetter ist optional. Ohne Timeout würde ein hängender
    // Fetch (open-meteo nicht erreichbar/langsam) den gesamten Tool-Aufruf
    // blockieren und bei Retries den Server sättigen. Lieber ohne Wetter erfassen.
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 4000);
    let res: Response;
    try {
      res = await fetch(url, { next: { revalidate: 0 }, signal: ctrl.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) return null;
    const data = await res.json();

    const c = data.current;
    const hourlyPressures: number[] = data.hourly?.surface_pressure ?? [];

    // 3h pressure delta: compare last entry to entry 3 positions earlier
    let pressureDelta3h: number | null = null;
    if (hourlyPressures.length >= 4) {
      const latest = hourlyPressures[hourlyPressures.length - 1];
      const minus3h = hourlyPressures[hourlyPressures.length - 4];
      pressureDelta3h = Math.round((latest - minus3h) * 10) / 10;
    }

    const windDir: number = c.wind_direction_10m ?? 0;
    const windSpeed: number = c.wind_speed_10m ?? 0;
    const humidity: number = c.relative_humidity_2m ?? 100;

    // Föhn heuristic for Schaffhausen (north of Alps):
    // south wind (150–240°), wind > 20 km/h, low humidity
    const isFoehnLikely = windDir >= 150 && windDir <= 240 && windSpeed > 20 && humidity < 45;

    const isPressureTrigger = pressureDelta3h !== null && pressureDelta3h < -5;

    return {
      fetchedAt: new Date().toISOString(),
      temperature: c.temperature_2m ?? 0,
      humidity,
      pressure: Math.round((c.surface_pressure ?? 0) * 10) / 10,
      pressureDelta3h,
      windSpeed: Math.round(windSpeed),
      windDirection: windDir,
      weatherDescription: WMO_DESCRIPTIONS[c.weather_code as number] ?? `Code ${c.weather_code}`,
      isFoehnLikely,
      isPressureTrigger,
    };
  } catch {
    return null;
  }
}
