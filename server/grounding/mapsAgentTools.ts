// Google Maps Platform "Maps Experience agent tools" (formerly Maps Grounding
// Lite): an MCP server that lets an LLM ground its output in Google Maps data.
// SST §10.2.1 permits generating LLM output from Maps content through these
// tools when the Google Maps source links are shown with that output.
//
// Output shapes are not fully documented, so parsing is deliberately tolerant
// (camelCase or snake_case, structuredContent or JSON text).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { JsonSchemaValidator, jsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/types.js";
import type { LatLng } from "../../shared/schemas.ts";
import type { FetchLike } from "../util/http.ts";

export const MAPS_AGENT_TOOLS_ENDPOINT = "https://mapstools.googleapis.com/mcp";

export interface AgentPlace {
  name?: string;
  address?: string;
  location?: LatLng;
  mapsUrl?: string;
  placeId?: string;
}

export interface AgentPlaceSearch {
  summary: string;
  places: AgentPlace[];
}

export interface AgentWeather {
  summary: string;
  tempC?: number;
  condition?: string;
  isDay?: boolean;
  address?: string;
  /** Trimmed JSON of the raw result, as grounding text for the Game Master. */
  details: string;
}

/** A walk between two points, from compute_routes. */
export interface AgentWalk {
  minutes: number;
  meters: number;
}

type Json = Record<string, unknown>;
interface ToolDef {
  name: string;
  inputSchema?: Json;
}
interface ToolResult {
  content?: { type: string; text?: string }[];
  structuredContent?: unknown;
  isError?: boolean;
}

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** Depth-first search for the first value under any of the given keys. */
export function findKey(value: unknown, keys: string[], depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findKey(item, keys, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  for (const key of keys) if (key in value) return (value as Json)[key];
  for (const child of Object.values(value)) {
    const found = findKey(child, keys, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Turn an MCP tool result into a JS value: structuredContent, else JSON text, else plain text. */
export function payloadOf(result: ToolResult): unknown {
  if (result.structuredContent !== undefined && result.structuredContent !== null) return result.structuredContent;
  const texts = (result.content ?? []).filter((c) => c.type === "text" && typeof c.text === "string").map((c) => c.text!);
  for (const text of texts) {
    try {
      return JSON.parse(text);
    } catch {
      // not JSON — fall through to plain text
    }
  }
  return { summary: texts.join("\n").trim() };
}

function readLatLng(value: unknown): LatLng | undefined {
  if (!isObject(value)) return undefined;
  const lat = value.latitude ?? value.lat;
  const lng = value.longitude ?? value.lng ?? value.lon;
  return typeof lat === "number" && typeof lng === "number" ? { lat, lng } : undefined;
}

function readText(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (isObject(value) && typeof value.text === "string") return value.text.trim() || undefined;
  return undefined;
}

export function parsePlace(raw: unknown): AgentPlace {
  if (!isObject(raw)) return {};
  const links = (raw.googleMapsLinks ?? raw.google_maps_links) as Json | undefined;
  const resourceName = typeof raw.name === "string" && raw.name.startsWith("places/") ? raw.name : undefined;
  const placeId = readText(raw.id) ?? readText(raw.place_id) ?? readText(raw.placeId) ?? resourceName?.slice("places/".length);
  return {
    name: readText(raw.displayName) ?? readText(raw.display_name) ?? readText(raw.title) ?? (resourceName ? undefined : readText(raw.name)),
    address: readText(raw.formattedAddress) ?? readText(raw.formatted_address) ?? readText(raw.address),
    location: readLatLng(raw.location) ?? readLatLng(raw.latLng) ?? readLatLng(raw.lat_lng),
    mapsUrl:
      readText(links?.placeUrl) ??
      readText(links?.place_url) ??
      readText(raw.googleMapsUri) ??
      readText(raw.google_maps_uri) ??
      (placeId ? `https://www.google.com/maps/place/?q=place_id:${placeId}` : undefined),
    placeId,
  };
}

export function parsePlaceSearch(payload: unknown): AgentPlaceSearch {
  const summary = readText(findKey(payload, ["summary", "answer", "text", "generativeSummary"])) ?? "";
  const list = findKey(payload, ["places", "results"]);
  const places = Array.isArray(list) ? list.map(parsePlace).filter((p) => p.location || p.mapsUrl || p.name) : [];
  return { summary, places };
}

export function parseWeather(payload: unknown): AgentWeather {
  const tempRaw = findKey(payload, ["temperature", "temp"]);
  const temp = typeof tempRaw === "number" ? tempRaw : isObject(tempRaw) && typeof tempRaw.degrees === "number" ? tempRaw.degrees : undefined;
  const conditionRaw = findKey(payload, ["weatherCondition", "weather_condition", "condition"]);
  const condition =
    readText(conditionRaw) ??
    (isObject(conditionRaw) ? readText(conditionRaw.description) ?? readText(conditionRaw.type)?.toLowerCase().replace(/_/g, " ") : undefined);
  const isDayRaw = findKey(payload, ["isDaytime", "is_daytime", "isDay"]);
  const address = readText(findKey(payload, ["formattedAddress", "formatted_address", "geocodedAddress", "address"]));
  const tempC = temp !== undefined ? Math.round(temp) : undefined;
  const summary = [tempC !== undefined ? `${tempC}°C` : null, condition].filter(Boolean).join(", ");
  const details = JSON.stringify(payload).slice(0, 1500);
  return { summary, tempC, condition, isDay: typeof isDayRaw === "boolean" ? isDayRaw : undefined, address, details };
}

/** Build `location_bias` in whatever shape the server's input schema declares. */
export function buildLocationBias(inputSchema: Json | undefined, center: LatLng, radiusM: number): { key: string; value: Json } {
  const props = isObject(inputSchema?.properties) ? (inputSchema!.properties as Json) : {};
  const key = "locationBias" in props ? "locationBias" : "location_bias";
  const bias = isObject(props[key]) ? (props[key] as Json) : {};
  const biasProps = isObject(bias.properties) ? (bias.properties as Json) : {};
  const point = (schema: unknown) => {
    const p = isObject(schema) && isObject(schema.properties) ? (schema.properties as Json) : {};
    return "lat" in p ? { lat: center.lat, lng: center.lng } : { latitude: center.lat, longitude: center.lng };
  };
  const radiusKey = (p: Json) => ("radiusMeters" in p ? "radiusMeters" : "radius" in p ? "radius" : "radius_meters");

  if (isObject(biasProps.circle)) {
    const circleProps = isObject(biasProps.circle.properties) ? (biasProps.circle.properties as Json) : {};
    return { key, value: { circle: { center: point(circleProps.center), [radiusKey(circleProps)]: radiusM } } };
  }
  if (isObject(biasProps.center)) return { key, value: { center: point(biasProps.center), [radiusKey(biasProps)]: radiusM } };
  if ("latitude" in biasProps || "lat" in biasProps) {
    return { key, value: { ...point({ properties: biasProps }), [radiusKey(biasProps)]: radiusM } };
  }
  return { key, value: { circle: { center: { latitude: center.lat, longitude: center.lng }, radius_meters: radiusM } } };
}

export interface MapsAgentToolsOptions {
  apiKey: string;
  endpoint?: string;
  fetchImpl?: FetchLike;
  log?: (message: string) => void;
  version?: string;
}

/** Seconds from "754s", 754 or { seconds: 754 }. */
function seconds(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : undefined;
  }
  if (isObject(value)) return seconds(value.seconds);
  return undefined;
}

/** The first route's duration and distance, in either case convention. */
export function parseRoute(payload: unknown): AgentWalk | null {
  const routes = findKey(payload, ["routes"]);
  const route = Array.isArray(routes) ? routes[0] : payload;
  const s = seconds(findKey(route, ["duration", "staticDuration", "static_duration"]));
  const m = Number(findKey(route, ["distanceMeters", "distance_meters"]));
  if (s === undefined && !Number.isFinite(m)) return null;
  // A walking pace of about 1.3 m/s fills in whichever is missing.
  const meters = Number.isFinite(m) ? Math.round(m) : Math.round((s ?? 0) * 1.3);
  return { minutes: Math.max(1, Math.round((s ?? meters / 1.3) / 60)), meters };
}

/** A tool's own error answer ("not supported for this location"): the connection is fine. */
class ToolAnswerError extends Error {}

/**
 * Accepts every tool result as it comes: our parsers read several shapes, so the SDK needn't hold
 * Google's answers to their declared output schemas (which also use formats Ajv doesn't know,
 * such as google-duration, and warned about them on every connect).
 */
const acceptAnyOutput: jsonSchemaValidator = {
  getValidator<T>(): JsonSchemaValidator<T> {
    return (input) => ({ valid: true, data: input as T, errorMessage: undefined });
  },
};

export class MapsAgentTools {
  readonly #opts: MapsAgentToolsOptions;
  #client: Promise<{ client: Client; tools: Map<string, ToolDef> }> | null = null;
  #loggedShapes = new Set<string>();

  constructor(opts: MapsAgentToolsOptions) {
    this.#opts = opts;
  }

  async #connect(): Promise<{ client: Client; tools: Map<string, ToolDef> }> {
    const transport = new StreamableHTTPClientTransport(new URL(this.#opts.endpoint ?? MAPS_AGENT_TOOLS_ENDPOINT), {
      requestInit: { headers: { "X-Goog-Api-Key": this.#opts.apiKey } },
      fetch: this.#opts.fetchImpl,
    });
    const client = new Client({ name: "common-ground", version: this.#opts.version ?? "0.1.0" }, { jsonSchemaValidator: acceptAnyOutput });
    await client.connect(transport);
    const listed = await client.listTools();
    const tools = new Map(listed.tools.map((t) => [t.name, { name: t.name, inputSchema: t.inputSchema as Json }]));
    return { client, tools };
  }

  #session(): Promise<{ client: Client; tools: Map<string, ToolDef> }> {
    this.#client ??= this.#connect().catch((error) => {
      this.#client = null;
      throw error;
    });
    return this.#client;
  }

  async #call(name: string, args: (tools: Map<string, ToolDef>) => Json): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const current = this.#session();
      const session = await current;
      try {
        const result = (await session.client.callTool({ name, arguments: args(session.tools) })) as ToolResult;
        const payload = payloadOf(result);
        if (result.isError) throw new ToolAnswerError(`${name} failed: ${JSON.stringify(payload).slice(0, 200)}`);
        if (!this.#loggedShapes.has(name) && isObject(payload)) {
          this.#loggedShapes.add(name);
          this.#opts.log?.(`[maps-agent-tools] ${name} result keys: ${Object.keys(payload).join(", ")}`);
        }
        return payload;
      } catch (error) {
        // The tool answered: asking again won't change it, and the connection is still good for
        // the calls running alongside this one.
        if (error instanceof ToolAnswerError) throw error;
        // Sessions can expire; reconnect once before giving up. Only the first call to notice
        // replaces the session, so a retry never closes the one another call just opened.
        if (this.#client === current) {
          this.#client = null;
          void session.client.close().catch(() => {});
        }
        if (attempt === 1) throw error;
      }
    }
    throw new Error("unreachable");
  }

  /** `languageCode` sets the summary's language (ISO 639-1, optionally with _COUNTRY, e.g. zh_CN). */
  async searchPlaces(textQuery: string, center?: LatLng, radiusM = 3000, languageCode = "en"): Promise<AgentPlaceSearch> {
    const payload = await this.#call("search_places", (tools) => {
      const args: Json = { text_query: textQuery, language_code: languageCode };
      if (center) {
        const bias = buildLocationBias(tools.get("search_places")?.inputSchema, center, radiusM);
        args[bias.key] = bias.value;
      }
      return args;
    });
    return parsePlaceSearch(payload);
  }

  /** How long a walk it is between two points (compute_routes, WALK). */
  async walkingRoute(from: LatLng, to: LatLng): Promise<AgentWalk | null> {
    const point = (p: LatLng) => ({ lat_lng: { latitude: p.lat, longitude: p.lng } });
    const payload = await this.#call("compute_routes", () => ({ origin: point(from), destination: point(to), travel_mode: "WALK" }));
    return parseRoute(payload);
  }

  async lookupWeather(center: LatLng): Promise<AgentWeather> {
    const payload = await this.#call("lookup_weather", () => ({
      location: { lat_lng: { latitude: center.lat, longitude: center.lng } },
      units_system: "METRIC",
    }));
    return parseWeather(payload);
  }

  async close(): Promise<void> {
    const session = await this.#client?.catch(() => null);
    this.#client = null;
    await session?.client.close().catch(() => {});
  }
}
