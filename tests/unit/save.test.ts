import { describe, expect, it } from "vitest";
import type { Expedition } from "../../shared/schemas.ts";
import { defaultSave, purgeExpiredMapsContent } from "../../src/state/store.ts";
import { npc } from "./fixtures.ts";

const DAY = 86_400_000;
const now = Date.UTC(2026, 9, 29);

function expedition(id: string, createdAt: number, mapsMode: "google" | "open", source: "search" | "postcard"): Expedition {
  return {
    id,
    createdAt,
    mapsMode,
    aiMode: "claude",
    destination: { lat: 38.7, lng: -9.1, label: "Lisbon", source, mapsUrl: source === "search" ? "https://maps.google.com/?cid=9" : undefined },
    locality: { city: "Lisbon" },
    title: "t",
    scene: "s",
    greeting: { language: "Portuguese", phrase: "Olá", meaning: "Hello" },
    curiosity: [],
    npcs: [{ ...npc, mapsUrl: mapsMode === "google" ? "https://maps.google.com/?cid=1" : undefined }],
    sources: [],
    notes: "",
  };
}

describe("purgeExpiredMapsContent (Google Maps 30-day coordinate retention)", () => {
  const save = {
    ...defaultSave(),
    expeditions: [
      expedition("fresh-google", now - 5 * DAY, "google", "postcard"),
      expedition("old-google-postcard", now - 40 * DAY, "google", "postcard"),
      expedition("old-google-search", now - 40 * DAY, "google", "search"),
      expedition("old-open", now - 400 * DAY, "open", "postcard"),
    ],
    atlas: [
      { expeditionId: "old-google-search", title: "t", destination: expedition("x", 0, "google", "search").destination, visitedAt: now - 40 * DAY, lenses: [] },
      { expeditionId: "old-open", title: "t", destination: expedition("y", 0, "open", "postcard").destination, visitedAt: now - 400 * DAY, lenses: [] },
    ],
  };

  it("drops Google coordinates after 30 days and keeps everything else", () => {
    const purged = purgeExpiredMapsContent(save, now);
    const byId = Object.fromEntries(purged.expeditions.map((e) => [e.id, e]));
    expect(byId["fresh-google"]!.npcs[0]!.location).toBeDefined();
    expect(byId["old-google-postcard"]!.npcs[0]!.location).toBeUndefined();
    expect(byId["old-google-postcard"]!.destination.lat).toBe(38.7);
    expect(byId["old-google-search"]).toBeUndefined();
    expect(byId["old-open"]!.npcs[0]!.location).toBeDefined();
    expect(purged.atlas[0]).toMatchObject({ coordinatesExpired: true, destination: { lat: 0, lng: 0, label: "Lisbon" } });
    expect(purged.atlas[1]!.coordinatesExpired).toBeUndefined();
  });
});
