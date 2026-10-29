import { describe, expect, it } from "vitest";
import { GroundingService } from "../../server/grounding/index.ts";
import type { MapsAgentTools } from "../../server/grounding/mapsAgentTools.ts";
import { describeLocalTime } from "../../server/grounding/openData.ts";
import { renderGoogleSearches } from "../../server/ai/prompts.ts";
import { fakeOpenDataFetch } from "./openDataFetch.ts";

const quiet = () => {};

describe("GroundingService (open mode)", () => {
  it("numbers Wikipedia sources, maps places and adds weather + local time", async () => {
    const fetchImpl = fakeOpenDataFetch();
    const grounding = new GroundingService({ config: { mapsMode: "open", userAgent: "test", wikipediaLang: "en" }, fetchImpl, log: quiet });
    const pack = await grounding.gather({ lat: -1.2841, lng: 36.8235, label: "Nairobi", country: "Kenya", postcardId: "nairobi", source: "postcard" });

    expect(pack.locality).toEqual({ city: "Nairobi", country: "Kenya" });
    // The city article leads; nearby articles follow nearest-first (the mosque is ~100 m away, the avenue ~130 m).
    expect(pack.articles.map((a) => `${a.sourceId}:${a.title}`)).toEqual(["W0:Nairobi", "W1:Jamia Mosque (Kenya)", "W2:Moi Avenue (Nairobi)"]);
    expect(pack.articles[0]!.extract).toBe("Nairobi is the capital and largest city of Kenya. It is a hub for business and culture in East Africa.");
    expect(pack.articles[2]!.extract.startsWith("Moi Avenue is one of the oldest roads")).toBe(true);
    expect(pack.places.map((p) => p.name)).toEqual(["Jamia Mosque", "Moi Avenue"]);
    expect(pack.weather).toMatchObject({ summary: "27°C, light rain", provider: "open-meteo" });
    expect(pack.localTime).toBe("Thursday 14:05 (afternoon)");
    expect(pack.sources.map((s) => s.id)).toEqual(["W0", "W1", "W2", "WX"]);
    expect(fetchImpl.urls.some((u) => u.includes("nominatim"))).toBe(false);
  });

  it("reverse-geocodes dropped pins", async () => {
    const fetchImpl = fakeOpenDataFetch();
    const grounding = new GroundingService({ config: { mapsMode: "open", userAgent: "test", wikipediaLang: "en" }, fetchImpl, log: quiet });
    const pack = await grounding.gather({ lat: -1.29, lng: 36.82, label: "Pin", source: "pin" });
    expect(pack.locality).toEqual({ city: "Nairobi", region: "Nairobi County", country: "Kenya" });
    expect(fetchImpl.urls.some((u) => u.includes("nominatim.openstreetmap.org/reverse"))).toBe(true);
  });

  it("survives every source being down", async () => {
    const grounding = new GroundingService({
      config: { mapsMode: "open", userAgent: "test", wikipediaLang: "en" },
      fetchImpl: (async () => new Response("down", { status: 503 })) as typeof fetch,
      log: quiet,
    });
    const pack = await grounding.gather({ lat: 1, lng: 2, label: "Somewhere", source: "pin" });
    expect(pack).toMatchObject({ articles: [], places: [], sources: [] });
  });
});

describe("GroundingService (google mode)", () => {
  const mapsTools = {
    searchPlaces: async (query: string) => ({
      summary: `Google summary for ${query.split(" ")[0]}`,
      places: [
        { name: "City Market", location: { lat: -1.2833, lng: 36.8271 }, mapsUrl: "https://maps.google.com/?cid=1", placeId: "A" },
        { name: "Uhuru Park", location: { lat: -1.29, lng: 36.81 }, mapsUrl: "https://maps.google.com/?cid=2", placeId: "B" },
      ],
    }),
    lookupWeather: async () => ({ summary: "24°C, Partly cloudy", tempC: 24, condition: "Partly cloudy", isDay: true, address: "Nairobi, Kenya", details: "{}" }),
  } as unknown as MapsAgentTools;

  it("grounds places through Maps agent tools with Google Maps links", async () => {
    const fetchImpl = fakeOpenDataFetch();
    const grounding = new GroundingService({ config: { mapsMode: "google", userAgent: "test", wikipediaLang: "en" }, mapsTools, fetchImpl, log: quiet });
    const pack = await grounding.gather({ lat: -1.2841, lng: 36.8235, label: "Nairobi", postcardId: "nairobi", source: "postcard" });
    expect(pack.places.filter((p) => p.kind === "google_place").map((p) => `${p.sourceId}:${p.name}`)).toEqual(["P0:City Market", "P1:Uhuru Park"]);
    expect(pack.places.some((p) => p.kind === "wikipedia")).toBe(false);
    expect(pack.sources.find((s) => s.id === "P0")).toMatchObject({ url: "https://maps.google.com/?cid=1", attribution: "Google Maps" });
    expect(pack.lensSummaries).toHaveLength(5);
    // Every search returned the same two places: each keeps its own [i] → P# mapping.
    expect(pack.lensSummaries.every((s) => s.placeIds.join() === "P0,P1")).toBe(true);
    const rendered = renderGoogleSearches(pack);
    expect(rendered).toContain("  result [0] = [P0] City Market");
    expect(rendered).toContain("  result [1] = [P1] Uhuru Park");
    expect(rendered[0]).toMatch(/^Google Maps search \(nature\): Google summary for/);
    expect(pack.weather).toMatchObject({ provider: "google", summary: "24°C, Partly cloudy" });
    expect(grounding.placeGrounding).toBe("google");
  });

  it("never sends coordinates from a Google search result to third parties", async () => {
    const fetchImpl = fakeOpenDataFetch();
    const grounding = new GroundingService({ config: { mapsMode: "google", userAgent: "test", wikipediaLang: "en" }, mapsTools, fetchImpl, log: quiet });
    await grounding.gather({ lat: 38.7077, lng: -9.1366, label: "Lisbon", source: "search", query: "lisbon" });
    expect(fetchImpl.urls.some((u) => u.includes("open-meteo") || u.includes("nominatim") || u.includes("geosearch"))).toBe(false);
    expect(fetchImpl.urls.some((u) => u.includes("gsrsearch=lisbon"))).toBe(true);
  });

  it("searches places with Google, never OpenStreetMap", async () => {
    const fetchImpl = fakeOpenDataFetch();
    const grounding = new GroundingService({ config: { mapsMode: "google", userAgent: "test", wikipediaLang: "en" }, mapsTools, fetchImpl, log: quiet });
    const results = await grounding.search("Nairobi market");
    expect(results[0]).toMatchObject({ label: "City Market", attribution: "Google Maps" });
    expect(fetchImpl.urls).toHaveLength(0);
  });
});

describe("describeLocalTime", () => {
  it("names the weekday and part of day", () => {
    expect(describeLocalTime("2026-10-29T07:40")).toBe("Thursday 07:40 (morning)");
    expect(describeLocalTime("2026-10-31T22:15")).toBe("Saturday 22:15 (night)");
    expect(describeLocalTime("nonsense")).toBeUndefined();
  });
});
