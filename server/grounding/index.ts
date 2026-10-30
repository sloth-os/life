// Grounding: everything the Game Master knows about a destination comes from
// here, as numbered sources (P# places, W# encyclopedia articles, WX weather)
// that the AI must cite and the UI shows as links.
import type { Destination, GeoResult, LatLng, Locality, Source, Weather } from "../../shared/schemas.ts";
import { findPostcard } from "../../shared/destinations.ts";
import { MAPS_LANGUAGE_CODE, type Lang } from "../../shared/languages.ts";
import { LENS_IDS, LENSES, type LensId } from "../../shared/world.ts";
import type { ServerConfig } from "../config.ts";
import { TtlCache } from "../util/cache.ts";
import { settle, type FetchLike } from "../util/http.ts";
import type { AgentWalk, MapsAgentTools } from "./mapsAgentTools.ts";
import { nominatimReverse, nominatimSearch, openMeteoNow, type LocalConditions } from "./openData.ts";
import { wikiArticle, wikiNearby, wikiSearch, type WikiArticle } from "./wikipedia.ts";

export interface GroundedPlace {
  sourceId: string;
  kind: "google_place" | "wikipedia";
  name?: string;
  lens?: LensId;
  location?: LatLng;
  mapsUrl?: string;
  placeId?: string;
  address?: string;
}

export interface GroundedArticle {
  sourceId: string;
  title: string;
  extract: string;
  url: string;
  distanceM?: number;
}

export interface GroundingPack {
  mapsMode: "google" | "open";
  center: LatLng;
  label: string;
  locality: Locality;
  localTime?: string;
  weather?: Weather;
  weatherDetails?: string;
  /**
   * Per-lens summaries written by Maps agent tools (Google mode only). A summary
   * cites places by their index in that search ("[0]"); `placeIds[i]` maps that
   * index to our global source id (places are deduplicated across searches).
   */
  lensSummaries: { lens: LensId; summary: string; placeIds: string[] }[];
  places: GroundedPlace[];
  articles: GroundedArticle[];
  sources: Source[];
}

export interface GroundingDeps {
  config: Pick<ServerConfig, "mapsMode" | "userAgent" | "wikipediaLang"> & Partial<Pick<ServerConfig, "mapsWalkingRoutes">>;
  mapsTools?: MapsAgentTools;
  fetchImpl?: FetchLike;
  log?: (message: string) => void;
}

const MAX_ARTICLES = 8;

export class GroundingService {
  #deps: GroundingDeps;
  /** Raw grounding is session-scoped: kept in memory briefly, never persisted. */
  readonly #packs = new TtlCache<GroundingPack>(2 * 60 * 60 * 1000, 200);
  // Open data is cached to spare the free services (and stay under their rate limits).
  readonly #wikiCache = new TtlCache<unknown>(24 * 60 * 60 * 1000, 2000);
  readonly #weatherCache = new TtlCache<unknown>(15 * 60 * 1000, 1000);
  readonly #geocodeCache = new TtlCache<unknown>(24 * 60 * 60 * 1000, 2000);

  constructor(deps: GroundingDeps) {
    this.#deps = deps;
  }

  /** New settings (hot reload): the caches stay, so expeditions in progress keep their grounding. */
  reconfigure(deps: Pick<GroundingDeps, "config" | "mapsTools">): void {
    this.#deps = { ...this.#deps, ...deps };
  }

  get mapsTools(): MapsAgentTools | undefined {
    return this.#deps.mapsTools;
  }

  get placeGrounding(): "google" | "wikipedia" {
    return this.#deps.config.mapsMode === "google" && this.#deps.mapsTools ? "google" : "wikipedia";
  }

  /**
   * Walking times from the arrival point to each Google place (undefined where there's none), when
   * MAPS_WALKING_ROUTES is on. Each route is a billed call, so they run in parallel and give up quickly.
   */
  async walkingTimes(from: LatLng, to: (LatLng | undefined)[]): Promise<(AgentWalk | undefined)[]> {
    const tools = this.#deps.mapsTools;
    if (!tools || !this.#deps.config.mapsWalkingRoutes) return to.map(() => undefined);
    const deadline = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 8_000));
    return Promise.all(
      to.map((point) =>
        point
          ? Promise.race([
              tools.walkingRoute(from, point).then(
                (walk) => walk ?? undefined,
                (error: unknown) => {
                  this.#log(`[grounding] compute_routes failed: ${error instanceof Error ? error.message : String(error)}`);
                  return undefined;
                },
              ),
              deadline,
            ])
          : undefined,
      ),
    );
  }

  cached(expeditionId: string): GroundingPack | undefined {
    return this.#packs.get(expeditionId);
  }

  remember(expeditionId: string, pack: GroundingPack): void {
    this.#packs.set(expeditionId, pack);
  }

  #log(message: string): void {
    (this.#deps.log ?? console.warn)(message);
  }

  async search(query: string): Promise<GeoResult[]> {
    const { config, mapsTools } = this.#deps;
    if (config.mapsMode === "google") {
      if (!mapsTools) return [];
      const found = await mapsTools.searchPlaces(query);
      return found.places
        .filter((p): p is typeof p & { location: LatLng } => Boolean(p.location))
        .slice(0, 6)
        .map((p, i) => ({
          label: p.name ?? `${query} (result ${i + 1})`,
          sublabel: p.address,
          lat: p.location.lat,
          lng: p.location.lng,
          mapsUrl: p.mapsUrl,
          attribution: "Google Maps",
        }));
    }
    return nominatimSearch(query, { userAgent: config.userAgent, fetchImpl: this.#deps.fetchImpl, cache: this.#geocodeCache });
  }

  /** `language` is the player's: Google's place summaries come in it. */
  async gather(destination: Destination, language: Lang = "en"): Promise<GroundingPack> {
    const { config, mapsTools } = this.#deps;
    const http = { userAgent: config.userAgent, fetchImpl: this.#deps.fetchImpl };
    const wiki = { lang: config.wikipediaLang, ...http, cache: this.#wikiCache };
    const center = { lat: destination.lat, lng: destination.lng };
    const postcard = findPostcard(destination.postcardId);
    const google = config.mapsMode === "google";
    // Coordinates that came out of a Google search result stay inside Google's
    // services: third-party lookups then use the player's own words instead.
    const coordsAreGoogleContent = google && destination.source === "search";

    const knownLocality: Locality = postcard ? { city: postcard.name, country: postcard.country } : { country: destination.country };
    const localityPromise: Promise<Locality> =
      postcard || google ? Promise.resolve(knownLocality) : settle(nominatimReverse(center.lat, center.lng, { ...http, cache: this.#geocodeCache }), knownLocality, "reverse geocoding", (m) => this.#log(m));

    const conditionsPromise: Promise<LocalConditions> = coordsAreGoogleContent
      ? Promise.resolve({})
      : settle(openMeteoNow(center.lat, center.lng, { ...http, cache: this.#weatherCache }), {}, "Open-Meteo", (m) => this.#log(m));

    const googleWeatherPromise = google && mapsTools ? settle(mapsTools.lookupWeather(center).then((w) => w as typeof w | null), null, "lookup_weather", (m) => this.#log(m)) : Promise.resolve(null);

    const lensSearches =
      google && mapsTools
        ? LENS_IDS.map((lens) =>
            settle(
              mapsTools.searchPlaces(`${LENSES[lens].placeQuery} near ${destination.query ?? destination.label}`, center, 4000, MAPS_LANGUAGE_CODE[language]).then((r) => ({ lens, ...r })),
              { lens, summary: "", places: [] },
              `search_places(${lens})`,
              (m) => this.#log(m),
            ),
          )
        : [];

    const nearbyPromise = coordsAreGoogleContent
      ? settle(wikiSearch(destination.query ?? destination.label, wiki), [], "Wikipedia search", (m) => this.#log(m))
      : settle(wikiNearby(center.lat, center.lng, { ...wiki, radiusM: 10_000, limit: 20 }), [], "Wikipedia geosearch", (m) => this.#log(m));

    const locality = await localityPromise;
    const headline = postcard?.name ?? locality.city ?? (destination.source === "pin" ? undefined : destination.label);
    const headlinePromise = headline ? settle(wikiArticle(headline, wiki), null, "Wikipedia article", (m) => this.#log(m)) : Promise.resolve(null);

    const [conditions, googleWeather, lensResults, nearby, headlineArticle] = await Promise.all([
      conditionsPromise,
      googleWeatherPromise,
      Promise.all(lensSearches),
      nearbyPromise,
      headlinePromise,
    ]);

    const sources: Source[] = [];
    const places: GroundedPlace[] = [];
    const lensSummaries: GroundingPack["lensSummaries"] = [];

    // P#: Google Maps places from agent tools, deduplicated across lenses.
    const idByKey = new Map<string, string>();
    for (const result of lensResults) {
      const placeIds: string[] = [];
      for (const place of result.places) {
        const key = place.placeId ?? place.mapsUrl ?? place.name ?? `${result.lens}:${placeIds.length}`;
        let sourceId = idByKey.get(key);
        if (!sourceId) {
          sourceId = `P${places.length}`;
          idByKey.set(key, sourceId);
          places.push({ sourceId, kind: "google_place", lens: result.lens, ...place });
          sources.push({ id: sourceId, kind: "google_place", title: place.name ?? `Google Maps place ${places.length}`, url: place.mapsUrl, attribution: "Google Maps" });
        }
        placeIds.push(sourceId);
      }
      if (result.summary || placeIds.length) lensSummaries.push({ lens: result.lens, summary: result.summary.slice(0, 900), placeIds });
    }

    // W#: Wikipedia articles; in Open mode those with coordinates double as places.
    const articles: GroundedArticle[] = [];
    const pool: WikiArticle[] = [];
    if (headlineArticle) pool.push(headlineArticle);
    for (const article of nearby) if (!pool.some((a) => a.title === article.title)) pool.push(article);
    for (const article of pool.slice(0, MAX_ARTICLES)) {
      const sourceId = `W${articles.length}`;
      articles.push({ sourceId, title: article.title, extract: article.extract, url: article.url, distanceM: article.distanceM });
      sources.push({ id: sourceId, kind: "wikipedia", title: article.title, url: article.url, attribution: "Wikipedia (CC BY-SA 4.0)", snippet: article.extract.slice(0, 220) });
      if (!google && article.lat !== undefined && article.lng !== undefined && article.distanceM !== undefined) {
        places.push({ sourceId, kind: "wikipedia", name: article.title.replace(/\s*\([^)]*\)$/, ""), location: { lat: article.lat, lng: article.lng } });
      }
    }

    // WX: weather — Google's in Google mode, Open-Meteo otherwise.
    let weather: Weather | undefined;
    let weatherDetails: string | undefined;
    if (googleWeather?.summary) {
      weather = { summary: googleWeather.summary, tempC: googleWeather.tempC, condition: googleWeather.condition, isDay: googleWeather.isDay, provider: "google", attribution: "Weather: Google Maps" };
      weatherDetails = googleWeather.details;
    } else if (!google && conditions.weather) {
      weather = conditions.weather;
    }
    if (weather) sources.push({ id: "WX", kind: "weather", title: `Current weather: ${weather.summary}`, attribution: weather.attribution });

    if (!locality.city && googleWeather?.address) locality.city = googleWeather.address.split(",")[0]?.trim();

    return {
      mapsMode: google ? "google" : "open",
      center,
      label: destination.label,
      locality,
      localTime: conditions.localTime,
      weather,
      weatherDetails,
      lensSummaries,
      places,
      articles,
      sources,
    };
  }
}
