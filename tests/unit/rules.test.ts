import { describe, expect, it } from "vitest";
import {
  INSIGHT_THRESHOLDS,
  applyRapport,
  calibrationGap,
  clampDelta,
  encounterXp,
  gateInsights,
  initialSkillProfile,
  rankFor,
  rapportTier,
  scheduleRecall,
  suggestedDifficulty,
  updateSkill,
  weakestSkill,
} from "../../shared/rules.ts";
import { skillLevelName } from "../../shared/skills.ts";

const insights = INSIGHT_THRESHOLDS.map((threshold, i) => ({ id: `i${i + 1}`, threshold }));

describe("rapport", () => {
  it("clamps model-proposed deltas to the allowed range", () => {
    expect(clampDelta(40)).toBe(12);
    expect(clampDelta(-99)).toBe(-15);
    expect(clampDelta(3.6)).toBe(4);
    expect(clampDelta(Number.NaN)).toBe(0);
  });

  it("keeps rapport within 0..100", () => {
    expect(applyRapport(95, 12)).toBe(100);
    expect(applyRapport(4, -15)).toBe(0);
    expect(applyRapport(40, 7)).toBe(47);
  });

  it("names tiers", () => {
    expect(rapportTier(10)).toBe("Stranger");
    expect(rapportTier(25)).toBe("Acquainted");
    expect(rapportTier(50)).toBe("Warm");
    expect(rapportTier(75)).toBe("Trusted");
  });
});

describe("insight gating", () => {
  it("accepts an insight only once rapport reaches its threshold", () => {
    expect(gateInsights(["i1"], insights, [], 29)).toEqual([]);
    expect(gateInsights(["i1"], insights, [], 30)).toEqual(["i1"]);
  });

  it("reveals at most one new insight per reply and skips known ones", () => {
    expect(gateInsights(["i1", "i2"], insights, [], 90)).toEqual(["i1"]);
    expect(gateInsights(["i1", "i2"], insights, ["i1"], 90)).toEqual(["i2"]);
  });

  it("ignores ids the persona doesn't have", () => {
    expect(gateInsights(["i9", "nope"], insights, [], 100)).toEqual([]);
  });
});

describe("skills", () => {
  it("moves ratings toward 25×score, faster while evidence is scarce", () => {
    const start = initialSkillProfile().curiosity;
    const first = updateSkill(start, 4);
    expect(first.rating).toBe(Math.round(20 + 0.35 * (100 - 20)));
    expect(first.evidence).toBe(1);
    let p = first;
    for (let i = 0; i < 3; i++) p = updateSkill(p, 4);
    const before = p.rating;
    const after = updateSkill(p, 4).rating;
    expect(after - before).toBe(Math.round(0.2 * (100 - before)));
  });

  it("ignores skills that weren't exercised", () => {
    const start = initialSkillProfile().empathy;
    expect(updateSkill(start, null)).toBe(start);
  });

  it("finds the weakest skill and suggests difficulty", () => {
    const profile = initialSkillProfile("listening");
    expect(weakestSkill(profile)).toBe("listening");
    expect(suggestedDifficulty(profile)).toBe(1);
    for (const id of Object.keys(profile) as (keyof typeof profile)[]) profile[id].rating = 70;
    expect(suggestedDifficulty(profile)).toBe(3);
  });

  it("names levels", () => {
    expect(skillLevelName(10)).toBe("Novice");
    expect(skillLevelName(45)).toBe("Practitioner");
    expect(skillLevelName(85)).toBe("Mentor");
  });
});

describe("progression", () => {
  it("computes encounter XP from its parts", () => {
    const xp = encounterXp({ rapportGained: 40, insights: 2, goalAchieved: true, scores: { curiosity: 3, listening: 2, empathy: null }, reflected: true });
    expect(xp.total).toBe(40 + 30 + 30 + 25 + 10);
    expect(xp.parts.map((p) => p.label)).toContain("Goal achieved");
  });

  it("never awards negative rapport XP", () => {
    expect(encounterXp({ rapportGained: -20, insights: 0, goalAchieved: false, scores: {}, reflected: false }).total).toBe(0);
  });

  it("ranks by XP", () => {
    expect(rankFor(0)).toMatchObject({ name: "Newcomer", next: 150 });
    expect(rankFor(420)).toMatchObject({ name: "Traveler", floor: 400 });
    expect(rankFor(5000).next).toBeNull();
  });

  it("measures calibration between self-rating and mentor scores", () => {
    expect(calibrationGap(5, { curiosity: 2, listening: 2 })).toBe(2);
    expect(calibrationGap(1, { curiosity: 2 })).toBe(-2);
    expect(calibrationGap(3, { curiosity: null })).toBeNull();
  });
});

describe("spaced recall", () => {
  const now = Date.UTC(2026, 9, 29);
  const day = 86_400_000;

  it("promotes on success and resets on failure", () => {
    const a = scheduleRecall({ box: 1, dueAt: now }, true, now);
    expect(a).toEqual({ box: 2, dueAt: now + day });
    const b = scheduleRecall({ box: 4, dueAt: now }, true, now);
    expect(b).toEqual({ box: 5, dueAt: now + 16 * day });
    expect(scheduleRecall(b, false, now)).toEqual({ box: 1, dueAt: now });
  });
});
