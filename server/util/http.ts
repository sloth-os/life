import type { TtlCache } from "./cache.ts";

export type FetchLike = typeof fetch;

export interface FetchJsonOptions {
  userAgent: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
  fetchImpl?: FetchLike;
  /** Cache successful responses by URL (open data only — never Google Maps content). */
  cache?: TtlCache<unknown>;
}

const RETRYABLE = new Set([429, 503]);

/**
 * GET a JSON document with a timeout and an identifying User-Agent (required by
 * Wikipedia/Nominatim policies). Retries once, politely, when rate-limited.
 */
export async function fetchJson<T>(url: string, options: FetchJsonOptions): Promise<T> {
  const hit = options.cache?.get(url);
  if (hit !== undefined) return hit as T;
  const fetchImpl = options.fetchImpl ?? fetch;
  for (let attempt = 0; ; attempt++) {
    const response = await fetchImpl(url, {
      headers: { "User-Agent": options.userAgent, Accept: "application/json", ...options.headers },
      signal: AbortSignal.timeout(options.timeoutMs ?? 8000),
    });
    if (response.ok) {
      const data = (await response.json()) as T;
      options.cache?.set(url, data);
      return data;
    }
    if (attempt === 0 && RETRYABLE.has(response.status)) {
      const wait = Math.min(4000, Number(response.headers.get("retry-after") ?? 1) * 1000 || 1000);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    throw new Error(`GET ${new URL(url).host} failed: ${response.status}`);
  }
}

/** Resolve to the fallback instead of throwing; grounding sources are best-effort. */
export async function settle<T>(promise: Promise<T>, fallback: T, label: string, log: (msg: string) => void): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    log(`[grounding] ${label} unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return fallback;
  }
}

export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}
