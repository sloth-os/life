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
  /** Google mode: how far a walk the local is from where the player arrives (Maps agent tools). */
  walk: z.object({ minutes: z.number(), meters: z.number() }).optional(),
});
export type NpcCard = z.infer<typeof NpcCardSchema>;

export const ExpeditionSchema = z.object({
  id: text(40),
  createdAt: z.number(),
  mapsMode: z.enum(["google", "open"]),
  aiMode: z.enum(["claude", "openai", "demo"]),
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

/** The part of an expedition the player reads first, while the locals are still being written. */
export type ExpeditionBriefing = Pick<Expedition, "destination" | "mapsMode" | "locality" | "title" | "scene" | "weather" | "greeting" | "curiosity">;

/** How far a long model call has got, streamed while the player waits. */
export interface StreamProgress {
  phase: "grounding" | "thinking" | "writing";
  elapsedMs: number;
  /** Characters of model reasoning so far (0 when the model doesn't expose it). */
  thinking: number;
  /** Characters of the answer written so far. */
  written: number;
}

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

export const TONES = ["warm", "friendly", "neutral", "hesitant", "tense", "flat", "impatient"] as const;
export const PACES = ["slow", "natural", "fast"] as const;

/** How a spoken line sounded (voice mode): the local hears it, the mentor may comment on it. */
export const DeliverySchema = z.object({
  tone: z.enum(TONES),
  pace: z.enum(PACES),
  clarity: z.number().int().min(0).max(100),
  note: text(240),
});
export type Delivery = z.infer<typeof DeliverySchema>;

const ReactionSchema = z.object({ thought: text(400), rapportDelta: z.number() });

export const PlayerTurnSchema = z.object({
  speaker: z.literal("player"),
  text: text(PLAYER_MESSAGE_MAX),
  moves: z.array(z.enum(MOVE_IDS)).max(8).optional(),
  delivery: DeliverySchema.optional(),
  /** Mediation scenes: each party's private reaction to this line. */
  reactions: z.object({ a: ReactionSchema, b: ReactionSchema }).optional(),
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

export const TurnRequestSchema = z.object({ ...EncounterBase, playerMessage: text(PLAYER_MESSAGE_MAX).min(1), playerDelivery: DeliverySchema.optional() });
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

// ── Mediation scenes: two locals at odds, the learner in the middle ────────
export const PARTY_IDS = ["a", "b"] as const;
export type PartyId = (typeof PARTY_IDS)[number];

export const PartySchema = z.object({
  id: z.enum(PARTY_IDS),
  name: text(60),
  age: z.number().int().min(10).max(110),
  role: text(80),
  pronouns: text(30),
  /** What they say they want. */
  position: text(300),
  /** Why they want it: hidden from the learner, who has to find it out. */
  interest: text(300),
  temperament: text(200),
  hue: z.number().min(0).max(360),
});
export type Party = z.infer<typeof PartySchema>;

export const MediationSceneSchema = z.object({
  id: text(40),
  title: text(120),
  placeName: text(120),
  /** What the learner sees as they arrive. */
  situation: text(600),
  topic: text(160),
  parties: z.tuple([PartySchema, PartySchema]),
  /** What both actually want: hidden, the way through. */
  sharedInterest: text(300),
  goal: text(200),
  opening: z.array(z.object({ who: z.enum(PARTY_IDS), text: text(400), gesture: text(160) })).min(1).max(3),
  startTension: z.number().int().min(0).max(100),
});
export type MediationScene = z.infer<typeof MediationSceneSchema>;

export const PartyTurnSchema = z.object({
  speaker: z.literal("party"),
  who: z.enum(PARTY_IDS),
  text: text(800),
  gesture: text(200).optional(),
  emotion: z.enum(EMOTION_IDS),
});
export const MediationEntrySchema = z.discriminatedUnion("speaker", [PlayerTurnSchema, PartyTurnSchema]);
export type PartyTurn = z.infer<typeof PartyTurnSchema>;
export type MediationEntry = z.infer<typeof MediationEntrySchema>;

const PartyRapportSchema = z.object({ a: z.number().min(0).max(100), b: z.number().min(0).max(100) });

export const MediationSceneRequestSchema = z.object({ context: ExpeditionContextSchema, player: PlayerSchema });
export type MediationSceneRequest = z.infer<typeof MediationSceneRequestSchema>;

const MediationBase = {
  context: ExpeditionContextSchema,
  scene: MediationSceneSchema,
  player: PlayerSchema,
  transcript: z.array(MediationEntrySchema).max(60),
  tension: z.number().min(0).max(100),
  rapport: PartyRapportSchema,
};

export const MediationTurnRequestSchema = z.object({ ...MediationBase, playerMessage: text(PLAYER_MESSAGE_MAX).min(1), playerDelivery: DeliverySchema.optional() });
export type MediationTurnRequest = z.infer<typeof MediationTurnRequestSchema>;

export const MEDIATION_END_REASONS = ["agreement", "walked_away", "turn_limit", "left"] as const;
export type MediationEndReason = (typeof MEDIATION_END_REASONS)[number];

export const MediationDebriefRequestSchema = z.object({
  ...MediationBase,
  endReason: z.enum(MEDIATION_END_REASONS),
  agreement: text(400).optional(),
  selfRating: z.number().int().min(1).max(5),
  selfNote: text(400).optional(),
});
export type MediationDebriefRequest = z.infer<typeof MediationDebriefRequestSchema>;

export interface MediationTurnResult {
  replies: { who: PartyId; text: string; gesture: string; emotion: EmotionId }[];
  /** Each party's private reaction to the learner's line (kept for the mentor). */
  reactions: { a: { thought: string; rapportDelta: number }; b: { thought: string; rapportDelta: number } };
  moves: MoveId[];
  tension: number;
  tensionDelta: number;
  rapport: { a: number; b: number };
  ended: boolean;
  endReason?: Exclude<MediationEndReason, "left">;
  /** What they agreed, when they did. */
  agreement?: string;
  wrapUp: boolean;
}

/** The learner can ask the mentor this many follow-up questions about one debrief. */
export const MENTOR_QUESTIONS_MAX = 5;

/** What the mentor needs of its own debrief to answer follow-up questions. */
export const DebriefRecapSchema = z.object({
  headline: text(200),
  summary: text(800),
  strengths: z.array(text(300)).max(4),
  growth: z.object({ skill: z.enum(SKILL_IDS), tip: text(400), original: text(PLAYER_MESSAGE_MAX), rewrite: text(600) }),
  scores: z.partialRecord(z.enum(SKILL_IDS), z.number().min(0).max(4).nullable()),
});

export const AskRequestSchema = z.object({
  ...EncounterBase,
  debrief: DebriefRecapSchema,
  history: z.array(z.object({ question: text(400), answer: text(1500) })).max(MENTOR_QUESTIONS_MAX),
  question: text(400).min(2),
});
export type AskRequest = z.infer<typeof AskRequestSchema>;

// ── Responses ─────────────────────────────────────────────────────────────
export interface MentorAnswer {
  answer: string;
  /** Short questions the learner might ask next. */
  followUps: string[];
}

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

// ── Voice and postcards ───────────────────────────────────────────────────
/** Recorded speech: a base64 WAV of at most `VOICE_MAX_SECONDS`. */
export const VOICE_MAX_SECONDS = 30;
const AudioSchema = z.string().min(64).max(3_000_000);

export const SpeakRequestSchema = z.object({
  text: text(600).min(1),
  /** The local's pronouns and id choose a voice that stays the same all conversation. */
  pronouns: text(30).optional(),
  seed: text(80).optional(),
});
export type SpeakRequest = z.infer<typeof SpeakRequestSchema>;

export const ListenRequestSchema = z.object({ audio: AudioSchema, context: text(300).optional() });
export type ListenRequest = z.infer<typeof ListenRequestSchema>;

export const PronounceRequestSchema = z.object({ audio: AudioSchema, phrase: text(80).min(1), language: text(60), meaning: text(160).optional() });
export type PronounceRequest = z.infer<typeof PronounceRequestSchema>;

export interface Heard extends Delivery {
  transcript: string;
}

export interface PronunciationResult {
  transcript: string;
  score: number;
  tip: string;
}

export const PostcardRequestSchema = z.object({
  expeditionId: text(40),
  label: text(160),
  country: text(120).optional(),
  lenses: z.array(z.enum(LENS_IDS)).max(4),
});
export type PostcardRequest = z.infer<typeof PostcardRequestSchema>;

export interface AppFeatures {
  /** The game listens through a voice model: speech in, with how it sounded, and pronunciation practice. */
  voice: boolean;
  /** Who gives the locals their voices: the voice model, or the browser's built-in speech. */
  voiceOutput: "model" | "browser";
  /** Postcard illustrations through the image gateway. */
  postcards: boolean;
  /** Teachers can create classes and assign expeditions. */
  classroom: boolean;
  /** 3D fly-ins over Google's photorealistic map. */
  flyIns: boolean;
}

export interface AppConfig {
  version: string;
  mapsMode: "google" | "open";
  aiMode: "claude" | "openai" | "demo";
  model?: string;
  features: AppFeatures;
  googleMapsApiKey?: string;
  googleMapId?: string;
  placeGrounding: "google" | "wikipedia";
  accessCodeRequired: boolean;
}

export interface ApiErrorBody {
  error: string;
  message: string;
}
