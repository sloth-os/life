/** A small in-memory TTL cache with LRU eviction. Process-local by design. */
export class TtlCache<V> {
  readonly #entries = new Map<string, { value: V; expires: number }>();
  readonly #ttlMs: number;
  readonly #maxEntries: number;

  constructor(ttlMs: number, maxEntries = 500) {
    this.#ttlMs = ttlMs;
    this.#maxEntries = maxEntries;
  }

  get(key: string, now = Date.now()): V | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= now) {
      this.#entries.delete(key);
      return undefined;
    }
    // Refresh recency.
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V, now = Date.now()): void {
    this.#entries.delete(key);
    this.#entries.set(key, { value, expires: now + this.#ttlMs });
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
  }

  async getOrCreate(key: string, create: () => Promise<V>): Promise<V> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const value = await create();
    this.set(key, value);
    return value;
  }

  get size(): number {
    return this.#entries.size;
  }
}

/** Sliding-window rate limiter keyed by client (e.g. IP). */
export class RateLimiter {
  readonly #hits = new Map<string, number[]>();
  readonly #limit: number;
  readonly #windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.#limit = limit;
    this.#windowMs = windowMs;
  }

  /** Returns true if the request is allowed (and records it). */
  allow(key: string, now = Date.now()): boolean {
    const recent = (this.#hits.get(key) ?? []).filter((t) => t > now - this.#windowMs);
    if (recent.length >= this.#limit) {
      this.#hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.#hits.set(key, recent);
    if (this.#hits.size > 10_000) this.#hits.clear();
    return true;
  }
}
