import { describe, expect, it } from "vitest";
import { RateLimiter, TtlCache } from "../../server/util/cache.ts";
import { fetchJson, haversineMeters } from "../../server/util/http.ts";

describe("fetchJson", () => {
  it("retries once when rate-limited, then caches the result", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return calls === 1 ? new Response("slow down", { status: 429, headers: { "retry-after": "1" } }) : new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
    const cache = new TtlCache<unknown>(60_000);
    expect(await fetchJson("https://example.test/a", { userAgent: "t", fetchImpl, cache })).toEqual({ ok: true });
    expect(await fetchJson("https://example.test/a", { userAgent: "t", fetchImpl, cache })).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it("sends an identifying User-Agent and gives up on hard errors", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get("user-agent") ?? "");
      return new Response("nope", { status: 404 });
    }) as typeof fetch;
    await expect(fetchJson("https://example.test/b", { userAgent: "CommonGround/test (me@example.org)", fetchImpl })).rejects.toThrow("404");
    expect(seen).toEqual(["CommonGround/test (me@example.org)"]);
  });
});

describe("TtlCache", () => {
  it("expires entries and evicts the least recently used", () => {
    const cache = new TtlCache<number>(1000, 2);
    cache.set("a", 1, 0);
    cache.set("b", 2, 0);
    expect(cache.get("a", 10)).toBe(1);
    cache.set("c", 3, 20);
    expect(cache.get("b", 30)).toBeUndefined();
    expect(cache.get("a", 30)).toBe(1);
    expect(cache.get("a", 5000)).toBeUndefined();
  });
});

describe("RateLimiter", () => {
  it("allows a burst up to the limit within the window", () => {
    const limiter = new RateLimiter(2, 1000);
    expect([limiter.allow("ip", 0), limiter.allow("ip", 1), limiter.allow("ip", 2)]).toEqual([true, true, false]);
    expect(limiter.allow("other", 2)).toBe(true);
    expect(limiter.allow("ip", 1500)).toBe(true);
  });
});

describe("haversineMeters", () => {
  it("measures short distances", () => {
    expect(Math.round(haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }))).toBe(111);
  });
});
