// The evaluation harness (scripts/eval.ts) with Demo AI and canned grounding: it runs the whole
// plan, and its checks catch what they are meant to.
import { describe, expect, it } from "vitest";
import { DemoGameAI } from "../../server/ai/demo.ts";
import { loadConfig } from "../../server/config.ts";
import { pickPlaces, reportMarkdown, runEvaluation, scanTropes, sourceOverlap } from "../../server/eval/index.ts";
import { GroundingService } from "../../server/grounding/index.ts";
import { fakeOpenDataFetch } from "./openDataFetch.ts";

describe("evaluation", () => {
  it("flags the tropes the persona charter bans, as words, not inside other words", () => {
    const flags = scanTropes("A timeless, exotic market. Her colourful stall sells untouched goods to a wise  elder.", "test");
    expect(flags.map((f) => f.term).sort()).toEqual(["colourful", "exotic", "timeless", "untouched", "wise elder"]);
    expect(flags.every((f) => f.hard)).toBe(true);
    expect(scanTropes("She works in exoticfoods logistics; the tribe of fans is loud.", "test")).toEqual([expect.objectContaining({ term: "tribe", hard: false })]);
    // Quoted, a term is talked about rather than used.
    expect(scanTropes("She resists questions about 'exotic' tastes and “timeless” postcards, and «primitive» labels.", "test")).toEqual([]);
    expect(scanTropes("An 'exotic market.", "test")).toEqual([expect.objectContaining({ term: "exotic" })]);
  });

  it("measures how much of a fact its sources contain", () => {
    expect(sourceOverlap("Moi Avenue is one of the oldest roads in Nairobi.", ["Moi Avenue is one of the oldest roads in Nairobi. It is intersected by Kenyatta Avenue."])).toBe(1);
    expect(sourceOverlap("The tram line opened in 1873.", ["Moi Avenue is one of the oldest roads in Nairobi."])).toBe(0);
    expect(sourceOverlap("anything", [])).toBeNull();
  });

  it("spreads its places across continents", () => {
    const continents = new Set(pickPlaces(6).map((p) => p.continent));
    expect(continents.size).toBe(6);
  });

  it("runs the whole plan and reports it", async () => {
    const config = loadConfig({}, []);
    const grounding = new GroundingService({ config, fetchImpl: fakeOpenDataFetch(), log: () => {} });
    const report = await runEvaluation({ ai: new DemoGameAI({ typingDelayMs: 0 }), grounding, places: 2 });
    expect(report.failures).toEqual([]);
    expect(report.conversations.map((c) => c.style)).toEqual(["excellent", "generic", "rude"]);
    expect(report.summary.realism.ok).toBe(true);
    expect(report.summary.mentor.verbatimRate).toBe(1);
    expect(report.summary.stereotypes).toMatchObject({ personas: 6, hardFlags: 0 });
    expect(report.summary.grounding.insights).toBeGreaterThan(0);
    expect(reportMarkdown(report)).toContain("All checks passed.");
  });
});
