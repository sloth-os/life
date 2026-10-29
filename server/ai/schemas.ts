// Structured-output schemas for each AI task. Field names are snake_case for
// the model; numeric ranges are described rather than enforced here — the game
// engine clamps and gates every value afterwards ("the model proposes, the
// engine disposes").
import { z } from "zod";
import { SKILL_IDS } from "../../shared/skills.ts";
import { EMOTION_IDS, LENS_IDS, MOVE_IDS, SCENARIO_IDS } from "../../shared/world.ts";

export const NpcDraftSchema = z.object({
  name: z.string(),
  age: z.number().int(),
  role: z.string().describe("Occupation or role, lower case, e.g. 'fish seller'"),
  place_source_id: z.string().nullable().describe("Source id (e.g. 'P3' or 'W1') of the real place where they are, or null"),
  place_name: z.string().describe("Name of the place where the visitor finds them"),
  lens: z.enum(LENS_IDS),
  scenario: z.enum(SCENARIO_IDS),
  difficulty: z.number().int().describe("1, 2 or 3"),
  hook: z.string().describe("One line the player sees before approaching"),
  goal: z.string().describe("The player's objective for this conversation"),
});

export const ExpeditionDraftSchema = z.object({
  title: z.string(),
  scene: z.string(),
  locality: z.object({ city: z.string(), region: z.string(), country: z.string() }).describe("Empty string when unknown"),
  greeting: z.object({ language: z.string(), phrase: z.string(), meaning: z.string(), pronunciation: z.string() }),
  curiosity: z.array(z.string()).describe("Exactly three questions"),
  notes: z.string(),
  npcs: z.array(NpcDraftSchema).describe("Exactly three locals"),
});

export const InsightDraftSchema = z.object({
  lens: z.enum(LENS_IDS),
  title: z.string(),
  fact: z.string(),
  source_ids: z.array(z.string()),
  quiz: z.object({
    question: z.string(),
    options: z.array(z.string()).describe("Exactly four options"),
    answer_index: z.number().int().describe("0-based index of the correct option"),
  }),
});

export const PersonaDraftSchema = z.object({
  pronouns: z.string(),
  personality: z.string(),
  communication_style: z.string(),
  background: z.string(),
  current_situation: z.string(),
  hidden_concern: z.string(),
  boundaries: z.array(z.string()),
  language_notes: z.string(),
  scenario_brief: z.string(),
  opening_line: z.string(),
  opening_gesture: z.string(),
  insights: z.array(InsightDraftSchema).describe("Exactly three, from casual to deep"),
});

export const NpcTurnDraftSchema = z.object({
  reply: z.string().describe("What you say aloud"),
  gesture: z.string().describe("Short non-verbal action, third person, or empty"),
  emotion: z.enum(EMOTION_IDS),
  rapport_delta: z.number().int().describe("Change caused by the visitor's latest message, -15 to +12"),
  perceived_moves: z.array(z.enum(MOVE_IDS)),
  inner_thought: z.string().describe("Your private, honest reaction to their latest message"),
  revealed_insight_ids: z.array(z.string()),
  phrase: z.object({ text: z.string(), meaning: z.string() }).nullable(),
  conversation_state: z.enum(["ongoing", "ended"]),
});

export const HintDraftSchema = z.object({
  skill: z.enum(SKILL_IDS),
  observation: z.string(),
  suggestion: z.string(),
  example: z.string(),
});

const score = z.number().int().nullable();

export const DebriefDraftSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  scores: z.object({
    curiosity: score,
    listening: score,
    empathy: score,
    respect: score,
    clarity: score,
    common_ground: score,
  }),
  evidence: z.array(
    z.object({
      skill: z.enum(SKILL_IDS),
      quote: z.string().describe("The learner's exact words, copied verbatim"),
      note: z.string(),
      positive: z.boolean(),
    }),
  ),
  strengths: z.array(z.string()),
  growth: z.object({
    skill: z.enum(SKILL_IDS),
    tip: z.string(),
    original: z.string().describe("One of the learner's lines, verbatim"),
    rewrite: z.string(),
  }),
  calibration: z.string(),
  reflection_question: z.string(),
  field_mission: z.object({ title: z.string(), description: z.string(), skill: z.enum(SKILL_IDS) }),
  goal_achieved: z.boolean(),
  memory: z.string().describe("1–2 sentences the local will remember about the learner"),
});

export const AskDraftSchema = z.object({
  answer: z.string().describe("Your answer to the learner's question, under 120 words"),
  follow_ups: z.array(z.string()).describe("Two short questions the learner might ask you next"),
});

export type NpcDraft = z.infer<typeof NpcDraftSchema>;
export type ExpeditionDraft = z.infer<typeof ExpeditionDraftSchema>;
export type InsightDraft = z.infer<typeof InsightDraftSchema>;
export type PersonaDraft = z.infer<typeof PersonaDraftSchema>;
export type NpcTurnDraft = z.infer<typeof NpcTurnDraftSchema>;
export type HintDraft = z.infer<typeof HintDraftSchema>;
export type DebriefDraft = z.infer<typeof DebriefDraftSchema>;
export type AskDraft = z.infer<typeof AskDraftSchema>;
