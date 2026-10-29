// World lenses, conversational moves, scenarios and emotions — the shared
// vocabulary between the AI agents, the game engine and the UI.
import type { SkillId } from "./skills.ts";

// ── Lenses ────────────────────────────────────────────────────────────────
export const LENS_IDS = ["nature", "culture", "history", "society", "economy"] as const;
export type LensId = (typeof LENS_IDS)[number];

export interface LensInfo {
  id: LensId;
  name: string;
  icon: string;
  color: string;
  description: string;
  /** Text query for place search near a destination (Maps agent tools). */
  placeQuery: string;
}

export const LENSES: Record<LensId, LensInfo> = {
  nature: {
    id: "nature",
    name: "Nature",
    icon: "🌿",
    color: "#2f7d4f",
    description: "Ecosystems, climate, landforms and how people live with them",
    placeQuery: "parks, gardens, waterfronts and nature spots",
  },
  culture: {
    id: "culture",
    name: "Culture",
    icon: "🎭",
    color: "#9b3d7a",
    description: "Traditions, food, arts, language and belief",
    placeQuery: "cultural landmarks, places of worship, museums and art spaces",
  },
  history: {
    id: "history",
    name: "History",
    icon: "📜",
    color: "#a2622b",
    description: "How this place came to be",
    placeQuery: "historic sites, monuments and old neighbourhoods",
  },
  society: {
    id: "society",
    name: "Society",
    icon: "🏘️",
    color: "#2d6aa8",
    description: "Community, education, health and public life",
    placeQuery: "community centers, libraries, schools, plazas and public squares",
  },
  economy: {
    id: "economy",
    name: "Economy",
    icon: "💰",
    color: "#b07d12",
    description: "Livelihoods, trade, prices and work",
    placeQuery: "local markets, workshops, small shops and street food",
  },
};

export function isLensId(value: unknown): value is LensId {
  return typeof value === "string" && (LENS_IDS as readonly string[]).includes(value);
}

// ── Moves: observable behaviours the NPC notices in each player message ──
export const MOVE_IDS = [
  "greeting",
  "open_question",
  "closed_question",
  "follow_up",
  "reflection",
  "empathy",
  "affirmation",
  "gratitude",
  "self_disclosure",
  "common_ground",
  "respectful_check",
  "clear_request",
  "humor",
  "small_talk",
  "farewell",
  "assumption",
  "judgment",
  "ignoring",
  "interrogating",
  "self_focus",
  "pushy",
  "rude",
  "vague",
] as const;
export type MoveId = (typeof MOVE_IDS)[number];

export interface MoveInfo {
  label: string;
  skill: SkillId | null;
  valence: 1 | 0 | -1;
  description: string;
}

export const MOVES: Record<MoveId, MoveInfo> = {
  greeting: { label: "greeting", skill: null, valence: 0, description: "Says hello" },
  open_question: { label: "open question", skill: "curiosity", valence: 1, description: "Asks a question that invites a story or explanation" },
  closed_question: { label: "closed question", skill: null, valence: 0, description: "Asks a yes/no or one-word question" },
  follow_up: { label: "follow-up", skill: "curiosity", valence: 1, description: "Builds on what was just said" },
  reflection: { label: "reflection", skill: "listening", valence: 1, description: "Paraphrases or summarizes what they said" },
  empathy: { label: "empathy", skill: "empathy", valence: 1, description: "Names or validates a feeling" },
  affirmation: { label: "affirmation", skill: "empathy", valence: 1, description: "Genuinely appreciates something about them" },
  gratitude: { label: "thanks", skill: "respect", valence: 1, description: "Thanks them sincerely" },
  self_disclosure: { label: "shares a bit", skill: "common_ground", valence: 1, description: "Shares something relevant about themselves" },
  common_ground: { label: "common ground", skill: "common_ground", valence: 1, description: "Finds a shared interest or value" },
  respectful_check: { label: "checks first", skill: "respect", valence: 1, description: "Asks permission or checks an assumption" },
  clear_request: { label: "clear ask", skill: "clarity", valence: 1, description: "States a need or intention clearly and kindly" },
  humor: { label: "light humor", skill: "common_ground", valence: 1, description: "Uses fitting, kind humor" },
  small_talk: { label: "small talk", skill: null, valence: 0, description: "Friendly but unremarkable chat" },
  farewell: { label: "farewell", skill: null, valence: 0, description: "Says goodbye" },
  assumption: { label: "assumption", skill: "respect", valence: -1, description: "Assumes or stereotypes" },
  judgment: { label: "judgment", skill: "empathy", valence: -1, description: "Criticizes or moralizes" },
  ignoring: { label: "missed it", skill: "listening", valence: -1, description: "Ignores what they just said" },
  interrogating: { label: "interrogating", skill: "curiosity", valence: -1, description: "Rapid-fire questions without listening" },
  self_focus: { label: "self-focus", skill: "listening", valence: -1, description: "Makes it all about themselves" },
  pushy: { label: "pushy", skill: "respect", valence: -1, description: "Pressures, demands or pushes a boundary" },
  rude: { label: "rude", skill: "respect", valence: -1, description: "Dismissive, insulting or condescending" },
  vague: { label: "vague", skill: "clarity", valence: -1, description: "Unclear about what they want" },
};

export function isMoveId(value: unknown): value is MoveId {
  return typeof value === "string" && (MOVE_IDS as readonly string[]).includes(value);
}

// ── Scenarios ─────────────────────────────────────────────────────────────
export const SCENARIO_IDS = ["conversation", "ask_help", "support", "negotiate", "perspective", "tradition", "collaborate"] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];

export interface ScenarioInfo {
  id: ScenarioId;
  name: string;
  icon: string;
  prompt: string;
  skills: SkillId[];
}

export const SCENARIOS: Record<ScenarioId, ScenarioInfo> = {
  conversation: { id: "conversation", name: "Hear their story", icon: "💬", prompt: "Strike up a conversation and learn their story", skills: ["curiosity", "listening"] },
  ask_help: { id: "ask_help", name: "Ask for help", icon: "🙋", prompt: "Ask for help with something you need", skills: ["clarity", "respect"] },
  support: { id: "support", name: "Be there", icon: "🫂", prompt: "They're having a rough day — be there for them", skills: ["empathy", "listening"] },
  negotiate: { id: "negotiate", name: "Fair deal", icon: "⚖️", prompt: "Reach a deal that's fair to you both", skills: ["clarity", "common_ground"] },
  perspective: { id: "perspective", name: "Another view", icon: "🔭", prompt: "They see a local issue differently — understand their view", skills: ["empathy", "respect", "common_ground"] },
  tradition: { id: "tradition", name: "Join a custom", icon: "🪔", prompt: "Take part in a local custom respectfully", skills: ["respect", "curiosity"] },
  collaborate: { id: "collaborate", name: "Work together", icon: "🛠️", prompt: "Work together on a small task", skills: ["common_ground", "clarity"] },
};

export function isScenarioId(value: unknown): value is ScenarioId {
  return typeof value === "string" && (SCENARIO_IDS as readonly string[]).includes(value);
}

// ── Emotions ──────────────────────────────────────────────────────────────
export const EMOTION_IDS = ["warm", "curious", "neutral", "guarded", "busy", "annoyed", "sad", "amused", "excited", "touched"] as const;
export type EmotionId = (typeof EMOTION_IDS)[number];

export const EMOTIONS: Record<EmotionId, { label: string; emoji: string }> = {
  warm: { label: "warm", emoji: "😊" },
  curious: { label: "curious", emoji: "🤔" },
  neutral: { label: "neutral", emoji: "😐" },
  guarded: { label: "guarded", emoji: "😶" },
  busy: { label: "busy", emoji: "⏳" },
  annoyed: { label: "annoyed", emoji: "😒" },
  sad: { label: "down", emoji: "😔" },
  amused: { label: "amused", emoji: "😄" },
  excited: { label: "excited", emoji: "🤩" },
  touched: { label: "touched", emoji: "🥹" },
};

export function isEmotionId(value: unknown): value is EmotionId {
  return typeof value === "string" && (EMOTION_IDS as readonly string[]).includes(value);
}
