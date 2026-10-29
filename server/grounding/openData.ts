// Open data used in Open map mode (and for local time in every mode):
// Open-Meteo weather (CC BY 4.0) and Nominatim geocoding (OpenStreetMap, ODbL).
import type { GeoResult, Locality, Weather } from "../../shared/schemas.ts";
import { fetchJson, type FetchJsonOptions } from "../util/http.ts";

const WMO: Record<number, string> = {
  0: "clear sky",
  1: "mostly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "foggy",
  48: "foggy with rime",
  51: "light drizzle",
  53: "drizzle",
  55: "heavy drizzle",
  56: "freezing drizzle",
  57: "freezing drizzle",
  61: "light rain",
  63: "rain",
  65: "heavy rain",
  66: "freezing rain",
  67: "freezing rain",
  71: "light snow",
  73: "snow",
  75: "heavy snow",
  77: "snow grains",
  80: "rain showers",
  81: "rain showers",
  82: "violent rain showers",
  85: "snow showers",
  86: "heavy snow showers",
  95: "thunderstorms",
  96: "thunderstorms with hail",
  99: "thunderstorms with hail",
};

export interface LocalConditions {
  weather?: Weather;
  /** e.g. "Thursday 07:40 (morning)" in the destination's own time zone. */
  localTime?: string;
  timezone?: string;
}

interface OpenMeteoResponse {
  timezone?: string;
  current?: {
    time?: string;
    temperature_2m?: number;
    apparent_temperature?: number;
    relative_humidity_2m?: number;
    weather_code?: number;
    wind_speed_10m?: number;
    is_day?: number;
  };
}

function partOfDay(hour: number): string {
  if (hour < 5) return "night";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 21) return "evening";
  return "night";
}

export function describeLocalTime(isoLocal: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(isoLocal);
  if (!match) return undefined;
  const [, y, m, d, hh, mm] = match;
  const weekday = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  return `${weekday} ${hh}:${mm} (${partOfDay(Number(hh))})`;
}

export async function openMeteoNow(lat: number, lng: number, opts: FetchJsonOptions): Promise<LocalConditions> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lng.toFixed(4),
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day",
    timezone: "auto",
  });
  const data = await fetchJson<OpenMeteoResponse>(`https://api.open-meteo.com/v1/forecast?${params}`, opts);
  const c = data.current ?? {};
  const condition = c.weather_code !== undefined ? WMO[c.weather_code] ?? "changeable weather" : undefined;
  const temp = typeof c.temperature_2m === "number" ? Math.round(c.temperature_2m) : undefined;
  const parts = [temp !== undefined ? `${temp}°C` : null, condition, typeof c.wind_speed_10m === "number" && c.wind_speed_10m > 25 ? "windy" : null];
  const summary = parts.filter(Boolean).join(", ");
  return {
    weather: summary
      ? { summary, tempC: temp, condition, isDay: c.is_day === undefined ? undefined : c.is_day === 1, provider: "open-meteo", attribution: "Weather data by Open-Meteo.com (CC BY 4.0)" }
      : undefined,
    localTime: c.time ? describeLocalTime(c.time) : undefined,
    timezone: data.timezone,
  };
}

interface NominatimPlace {
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  address?: Record<string, string>;
}

// Nominatim's usage policy allows at most one request per second.
let nominatimQueue: Promise<unknown> = Promise.resolve();
function throttled<T>(task: () => Promise<T>): Promise<T> {
  const run = nominatimQueue.then(task, task);
  nominatimQueue = run.then(
    () => new Promise((r) => setTimeout(r, 1100)),
    () => new Promise((r) => setTimeout(r, 1100)),
  );
  return run;
}

function localityFrom(address: Record<string, string> | undefined): Locality {
  if (!address) return {};
  return {
    city: address.city ?? address.town ?? address.village ?? address.municipality ?? address.county,
    region: address.state ?? address.region ?? address.province,
    country: address.country,
  };
}

export async function nominatimSearch(q: string, opts: FetchJsonOptions): Promise<GeoResult[]> {
  const params = new URLSearchParams({ q, format: "jsonv2", limit: "6", addressdetails: "1", "accept-language": "en" });
  const places = await throttled(() => fetchJson<NominatimPlace[]>(`https://nominatim.openstreetmap.org/search?${params}`, opts));
  return places.map((p) => {
    const loc = localityFrom(p.address);
    const label = p.name || p.display_name.split(",")[0] || p.display_name;
    return {
      label,
      sublabel: [loc.city !== label ? loc.city : undefined, loc.region, loc.country].filter(Boolean).join(", ") || undefined,
      lat: Number(p.lat),
      lng: Number(p.lon),
      attribution: "© OpenStreetMap contributors",
    };
  });
}

export async function nominatimReverse(lat: number, lng: number, opts: FetchJsonOptions): Promise<Locality> {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lng), format: "jsonv2", zoom: "10", addressdetails: "1", "accept-language": "en" });
  const place = await throttled(() => fetchJson<NominatimPlace>(`https://nominatim.openstreetmap.org/reverse?${params}`, opts));
  return localityFrom(place.address);
}
