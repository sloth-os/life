// API contract between the browser and the server. The server validates every
// request with these schemas; the client imports the inferred types only.
import { z } from "zod";
import { SKILL_IDS, type SkillId } from "./skills.ts";
import { EMOTION_IDS, LENS_IDS, MOVE_IDS, SCENARIO_IDS, type EmotionId, type MoveId } from "./world.ts";
import { PLAYER_MESSAGE_MAX } from "./rules.ts";

const text = (max: number) => z.string().max(max);

export const LatLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type LatLng = z.infer<typeof LatLngSchema>;

export const DestinationSchema = LatLngSchema.extend({
  label: text(160),
  country: text(80).optional(),
  postcardId: text(40).optional(),
  source: z.enum(["postcard", "search", "pin", "surprise"]),
  mapsUrl: text(600).optional(),
  /** What the player typed, for search destinations (used for text-only lookups). */
  query: text(160).optional(),
});
export type Destination = z.infer<typeof DestinationSchema>;

export const SourceSchema = z.object({
  id: text(12),
  kind: z.enum(["google_place", "wikipedia", "weather", "general"]),
  title: text(200),
  url: text(600).optional(),
  attribution: text(120),
  snippet: text(600).optional(),
});
export type Source = z.infer<typeof SourceSchema>;

export const WeatherSchema = z.object({
  summary: text(160),
  tempC: z.number().optional(),
  condition: text(80).optional(),
  isDay: z.boolean().optional(),
  provider: z.enum(["google", "open-meteo"]),
  attribution: text(120),
});
export type Weather = z.infer<typeof WeatherSchema>;

export const LocalitySchema = z.object({
  city: text(120).optional(),
  region: text(120).optional(),
  country: text(120).optional(),
});
export type Locality = z.infer<typeof LocalitySchema>;

export const GreetingSchema = z.object({
  language: text(60),
  phrase: text(80),
  meaning: text(160),
  pronunciation: text(80).optional(),
});
export type Greeting = z.infer<typeof GreetingSchema>;

export const PhraseSchema = z.object({ text: text(80), meaning: text(160) });
export type Phrase = z.infer<typeof PhraseSchema>;

export const DifficultySchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type Difficulty = z.infer<typeof DifficultySchema>;

export const NpcCardSchema = z.object({
  id: text(20),
  name: text(60),
  age: z.number().int().min(10).max(110),
  role: text(80),
  placeName: text(120),
  placeSourceId: text(12).optional(),
  location: LatLngSchema.optional(),
  mapsUrl: text(600).optional(),
  lens: z.enum(LENS_IDS),
  scenario: z.enum(SCENARIO_IDS),
  difficulty: DifficultySchema,
  hook: text(240),
  goal: text(200),
  hue: z.number().min(0).max(360),
});
export type NpcCard = z.infer<typeof NpcCardSchema>;

export const ExpeditionSchema = z.object({
  id: text(40),
  createdAt: z.number(),
  mapsMode: z.enum(["google", "open"]),
  aiMode: z.enum(["claude", "demo"]),
  destination: DestinationSchema,
  locality: LocalitySchema,
  title: text(120),
  scene: text(800),
  weather: WeatherSchema.optional(),
  greeting: GreetingSchema,
  curiosity: z.array(text(200)).max(5),
  npcs: z.array(NpcCardSchema).max(4),
  sources: z.array(SourceSchema).max(40),
  notes: text(6000),
});
export type Expedition = z.infer<typeof ExpeditionSchema>;

/** The compact slice of an expedition each later request carries. */
export const ExpeditionContextSchema = z.object({
  expeditionId: text(40),
  title: text(120),
  destinationLabel: text(160),
  locality: LocalitySchema,
  scene: text(800),
  weatherSummary: text(160).optional(),
  greeting: GreetingSchema,
  notes: text(6000),
  sources: z.array(SourceSchema.pick({ id: true, title: true, kind: true })).max(40),
});
export type ExpeditionContext = z.infer<typeof ExpeditionContextSchema>;

export const InsightSchema = z.object({
  id: text(8),
  lens: z.enum(LENS_IDS),
  title: text(100),
  fact: text(500),
  threshold: z.number().int().min(0).max(100),
  sourceIds: z.array(text(12)).max(4),
  quiz: z.object({
    question: text(200),
    options: z.array(text(140)).min(2).max(4),
    answerIndex: z.number().int().min(0).max(3),
  }),
});
export type Insight = z.infer<typeof InsightSchema>;

export const PersonaSchema = z.object({
  npcId: text(20),
  name: text(60),
  age: z.number().int().min(10).max(110),
  role: text(80),
  pronouns: text(30),
  placeName: text(120),
  personality: text(400),
  communicationStyle: text(300),
  background: text(600),
  currentSituation: text(400),
  hiddenConcern: text(300),
  boundaries: z.array(text(200)).max(4),
  languageNotes: text(300),
  scenarioBrief: text(500),
  openingLine: text(400),
  openingGesture: text(160),
  startingRapport: z.number().int().min(0).max(100),
  insights: z.array(InsightSchema).max(3),
});
export type Persona = z.infer<typeof PersonaSchema>;

export const PlayerTurnSchema = z.object({
  speaker: z.literal("player"),
  text: text(PLAYER_MESSAGE_MAX),
  moves: z.array(z.enum(MOVE_IDS)).max(8).optional(),
});
export const NpcTurnSchema = z.object({
  speaker: z.literal("npc"),
  text: text(1200),
  gesture: text(200).optional(),
  emotion: z.enum(EMOTION_IDS),
  rapportDelta: z.number(),
  rapportAfter: z.number(),
  innerThought: text(400).optional(),
  revealedInsightIds: z.array(text(8)).max(3),
  phrase: PhraseSchema.nullable().optional(),
});
export const TranscriptEntrySchema = z.discriminatedUnion("speaker", [PlayerTurnSchema, NpcTurnSchema]);
export type PlayerTurn = z.infer<typeof PlayerTurnSchema>;
export type NpcTurn = z.infer<typeof NpcTurnSchema>;
export type TranscriptEntry = z.infer<typeof TranscriptEntrySchema>;

export const PlayerSchema = z.object({
  name: text(40),
  ageBand: z.enum(["teen", "adult"]),
  focusSkill: z.enum(SKILL_IDS),
  skills: z.partialRecord(z.enum(SKILL_IDS), z.number().min(0).max(100)),
  recentScenarios: z.array(z.enum(SCENARIO_IDS)).max(12),
});
export type PlayerContext = z.infer<typeof PlayerSchema>;

const EncounterBase = {
  context: ExpeditionContextSchema,
  npc: NpcCardSchema,
  persona: PersonaSchema,
  player: PlayerSchema,
  transcript: z.array(TranscriptEntrySchema).max(40),
  rapport: z.number().min(0).max(100),
  unlockedInsightIds: z.array(text(8)).max(3),
  memory: text(500).optional(),
};

// ── Requests ──────────────────────────────────────────────────────────────
export const ExpeditionRequestSchema = z.object({ destination: DestinationSchema, player: PlayerSchema });
export type ExpeditionRequest = z.infer<typeof ExpeditionRequestSchema>;

export const PersonaRequestSchema = z.object({
  context: ExpeditionContextSchema,
  npc: NpcCardSchema,
  player: PlayerSchema,
  memory: text(500).optional(),
});
export type PersonaRequest = z.infer<typeof PersonaRequestSchema>;

export const TurnRequestSchema = z.object({ ...EncounterBase, playerMessage: text(PLAYER_MESSAGE_MAX).min(1) });
export type TurnRequest = z.infer<typeof TurnRequestSchema>;

export const HintRequestSchema = z.object(EncounterBase);
export type HintRequest = z.infer<typeof HintRequestSchema>;

export const END_REASONS = ["farewell", "walked_away", "turn_limit", "left"] as const;
export type EndReason = (typeof END_REASONS)[number];

export const DebriefRequestSchema = z.object({
  ...EncounterBase,
  startRapport: z.number().min(0).max(100),
  endReason: z.enum(END_REASONS),
  selfRating: z.number().int().min(1).max(5),
  selfNote: text(400).optional(),
});
export type DebriefRequest = z.infer<typeof DebriefRequestSchema>;

// ── Responses ─────────────────────────────────────────────────────────────
export interface TurnResult {
  reply: string;
  gesture: string;
  emotion: EmotionId;
  rapportDelta: number;
  rapport: number;
  moves: MoveId[];
  innerThought: string;
  revealedInsightIds: string[];
  phrase: Phrase | null;
  ended: boolean;
  endReason?: EndReason;
  wrapUp: boolean;
}

export interface Hint {
  skill: SkillId;
  observation: string;
  suggestion: string;
  example: string;
}

export interface DebriefEvidence {
  skill: SkillId;
  quote: string;
  note: string;
  positive: boolean;
}

export interface Debrief {
  headline: string;
  summary: string;
  scores: Record<SkillId, number | null>;
  evidence: DebriefEvidence[];
  strengths: string[];
  growth: { skill: SkillId; tip: string; original: string; rewrite: string };
  calibration: string;
  reflectionQuestion: string;
  fieldMission: { title: string; description: string; skill: SkillId };
  goalAchieved: boolean;
  memory: string;
}

export interface GeoResult {
  label: string;
  sublabel?: string;
  lat: number;
  lng: number;
  mapsUrl?: string;
  attribution: string;
}

export interface AppConfig {
  version: string;
  mapsMode: "google" | "open";
  aiMode: "claude" | "demo";
  model?: string;
  googleMapsApiKey?: string;
  googleMapId?: string;
  placeGrounding: "google" | "wikipedia";
  accessCodeRequired: boolean;
}

export interface ApiErrorBody {
  error: string;
  message: string;
}
