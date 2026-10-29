import { describe, expect, it } from "vitest";
import { POSTCARDS } from "../../shared/destinations.ts";
import { LENS_IDS } from "../../shared/world.ts";

describe("postcards", () => {
  it("cover every continent with distinct, valid places", () => {
    expect(new Set(POSTCARDS.map((p) => p.id)).size).toBe(POSTCARDS.length);
    for (const continent of ["Africa", "Asia", "Europe", "North America", "South America", "Oceania"]) {
      expect(POSTCARDS.filter((p) => p.continent === continent).length, continent).toBeGreaterThanOrEqual(3);
    }
    for (const p of POSTCARDS) {
      expect(Math.abs(p.lat), p.id).toBeLessThanOrEqual(90);
      expect(Math.abs(p.lng), p.id).toBeLessThanOrEqual(180);
      expect(p.lenses.length, p.id).toBeGreaterThan(0);
      expect(p.lenses.every((l) => (LENS_IDS as readonly string[]).includes(l)), p.id).toBe(true);
      expect(p.theme.length, p.id).toBeLessThanOrEqual(80);
    }
  });

  it("explore every lens from several places", () => {
    for (const lens of LENS_IDS) expect(POSTCARDS.filter((p) => p.lenses.includes(lens)).length, lens).toBeGreaterThanOrEqual(5);
  });
});
