// The English game vocabulary, read from the shared definitions the AI prompts use.
import { POSTCARDS } from "../../shared/destinations.ts";
import { SKILLS, SKILL_IDS, SKILL_LEVELS, type SkillId } from "../../shared/skills.ts";
import { EMOTIONS, LENSES, MOVES, SCENARIOS, type EmotionId, type LensId, type MoveId, type ScenarioId } from "../../shared/world.ts";
import type { DomainText, SkillText } from "./index.ts";

function byId<K extends string, V>(entries: [K, V][]): Record<K, V> {
  return Object.fromEntries(entries) as Record<K, V>;
}

export function englishDomain(): DomainText {
  return {
    skills: byId<SkillId, SkillText>(
      SKILL_IDS.map((id) => [id, { name: SKILLS[id].name, tagline: SKILLS[id].tagline, behaviors: [...SKILLS[id].behaviors], pitfalls: [...SKILLS[id].pitfalls], example: SKILLS[id].example, rubric: [...SKILLS[id].rubric] }]),
    ),
    lenses: byId<LensId, string>(Object.values(LENSES).map((lens) => [lens.id, lens.name])),
    moves: byId<MoveId, { label: string; description: string }>(Object.entries(MOVES).map(([id, move]) => [id as MoveId, { label: move.label, description: move.description }])),
    emotions: byId<EmotionId, string>(Object.entries(EMOTIONS).map(([id, e]) => [id as EmotionId, e.label])),
    scenarios: byId<ScenarioId, string>(Object.entries(SCENARIOS).map(([id, s]) => [id as ScenarioId, s.name])),
    ranks: {},
    levels: byId(SKILL_LEVELS.map((l) => [l, l])),
    tiers: { Stranger: "Stranger", Acquainted: "Acquainted", Warm: "Warm", Trusted: "Trusted" },
    continents: { Africa: "Africa", Asia: "Asia", Europe: "Europe", "North America": "North America", "South America": "South America", Oceania: "Oceania" },
    postcards: Object.fromEntries(POSTCARDS.map((p) => [p.id, { name: p.name, country: p.country, theme: p.theme }])),
    xp: {},
  };
}
