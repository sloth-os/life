// Wikipedia (CC BY-SA) as open, citable grounding for the Game Master.
import type { TtlCache } from "../util/cache.ts";
import { fetchJson, haversineMeters, type FetchLike } from "../util/http.ts";

export interface WikiArticle {
  title: string;
  extract: string;
  url: string;
  lat?: number;
  lng?: number;
  distanceM?: number;
}

interface WikiPage {
  title: string;
  extract?: string;
  fullurl?: string;
  missing?: boolean;
  coordinates?: { lat: number; lon: number }[];
  pageprops?: { disambiguation?: string };
  index?: number;
}

interface WikiQueryResponse {
  query?: { pages?: WikiPage[] };
}

export interface WikiOptions {
  lang: string;
  userAgent: string;
  fetchImpl?: FetchLike;
  cache?: TtlCache<unknown>;
}

const SKIP_TITLE = /^(List of|Lists of|Timeline of|Outline of|Index of|Geography of|Demographics of)\b/i;
const MAX_EXTRACT = 700;

function apiUrl(lang: string, params: Record<string, string>): string {
  const query = new URLSearchParams({ action: "query", format: "json", formatversion: "2", ...params });
  return `https://${lang}.wikipedia.org/w/api.php?${query}`;
}

function cleanExtract(extract: string): string {
  // Lead-sentence parentheticals are almost always pronunciations or native
  // spellings — noise for role-play. Drop them, then any elsewhere that are.
  const flat = extract.replace(/\s+/g, " ").trim();
  const firstEnd = flat.search(/(?<=[.!?])\s/);
  const first = (firstEnd === -1 ? flat : flat.slice(0, firstEnd))
    .replace(/\s*\([^()]*\)/g, "")
    .replace(/\s*,(\s+(?:is|was|are|were)\b)/, "$1");
  const rest = firstEnd === -1 ? "" : flat.slice(firstEnd);
  const text = `${first}${rest}`.replace(/\s*\([^()]*(?:pronounced|IPA|listen|\[)[^()]*\)/g, "").replace(/\s+/g, " ").trim();
  return text.length > MAX_EXTRACT ? `${text.slice(0, MAX_EXTRACT).replace(/\s+\S*$/, "")}…` : text;
}

function toArticle(page: WikiPage, lang: string, origin?: { lat: number; lng: number }): WikiArticle | null {
  if (page.missing || page.pageprops?.disambiguation !== undefined) return null;
  if (SKIP_TITLE.test(page.title)) return null;
  const extract = cleanExtract(page.extract ?? "");
  if (extract.length < 80) return null;
  const coord = page.coordinates?.[0];
  const article: WikiArticle = {
    title: page.title,
    extract,
    url: page.fullurl ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
  };
  if (coord) {
    article.lat = coord.lat;
    article.lng = coord.lon;
    if (origin) article.distanceM = Math.round(haversineMeters(origin, { lat: coord.lat, lng: coord.lon }));
  }
  return article;
}

const PAGE_PROPS = {
  prop: "extracts|coordinates|info|pageprops",
  exintro: "1",
  explaintext: "1",
  exsentences: "4",
  exlimit: "20",
  inprop: "url",
  ppprop: "disambiguation",
  colimit: "max",
};

/** Notable places with coordinates within `radiusM` of a point, nearest first. */
export async function wikiNearby(lat: number, lng: number, opts: WikiOptions & { radiusM?: number; limit?: number }): Promise<WikiArticle[]> {
  const url = apiUrl(opts.lang, {
    generator: "geosearch",
    ggscoord: `${lat}|${lng}`,
    ggsradius: String(Math.min(opts.radiusM ?? 10_000, 10_000)),
    ggslimit: String(opts.limit ?? 20),
    ...PAGE_PROPS,
  });
  const data = await fetchJson<WikiQueryResponse>(url, opts);
  return (data.query?.pages ?? [])
    .map((p) => toArticle(p, opts.lang, { lat, lng }))
    .filter((a): a is WikiArticle => a !== null)
    .sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0));
}

/** The lead section of a named article (e.g. the city itself), following redirects. */
export async function wikiArticle(title: string, opts: WikiOptions): Promise<WikiArticle | null> {
  const url = apiUrl(opts.lang, { titles: title, redirects: "1", ...PAGE_PROPS, exsentences: "5" });
  const data = await fetchJson<WikiQueryResponse>(url, opts);
  const page = data.query?.pages?.[0];
  return page ? toArticle(page, opts.lang) : null;
}

/** Full-text search, used when a destination's coordinates must not leave Google's services. */
export async function wikiSearch(text: string, opts: WikiOptions & { limit?: number }): Promise<WikiArticle[]> {
  const url = apiUrl(opts.lang, {
    generator: "search",
    gsrsearch: text,
    gsrlimit: String(opts.limit ?? 6),
    ...PAGE_PROPS,
  });
  const data = await fetchJson<WikiQueryResponse>(url, opts);
  return (data.query?.pages ?? [])
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((p) => toArticle(p, opts.lang))
    .filter((a): a is WikiArticle => a !== null);
}
