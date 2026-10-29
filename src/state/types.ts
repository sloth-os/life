import type { RecallState, SkillProfile } from "../../shared/rules.ts";
import type {
  AppConfig,
  Debrief,
  Destination,
  EndReason,
  Expedition,
  ExpeditionBriefing,
  Hint,
  Insight,
  NpcCard,
  Persona,
  Source,
  StreamProgress,
  TranscriptEntry,
} from "../../shared/schemas.ts";
import type { SkillId } from "../../shared/skills.ts";
import type { LensId, ScenarioId } from "../../shared/world.ts";

export type Screen = "title" | "onboarding" | "world" | "expedition" | "encounter" | "debrief" | "journal" | "compass" | "settings";

export interface PlayerProfile {
  name: string;
  ageBand: "teen" | "adult";
  focusSkill: SkillId;
  createdAt: number;
}

export interface Settings {
  voiceInput: boolean;
  voiceOutput: boolean;
  textScale: 1 | 1.15 | 1.3;
  reducedMotion: boolean;
  theme: "system" | "light" | "dark";
  accessCode: string;
}

export interface Progress {
  xp: number;
  skills: SkillProfile;
  calibration: number[];
  encounters: number;
  recentScenarios: ScenarioId[];
  /** yyyy-mm-dd → encounters finished that day (for the healthy-play nudge). */
  daily: Record<string, number>;
}

export interface JournalInsight {
  key: string;
  insight: Insight;
  npcName: string;
  placeName: string;
  city?: string;
  country?: string;
  sources: Source[];
  foundAt: number;
  recall: RecallState;
}

export interface JournalPhrase {
  text: string;
  meaning: string;
  language: string;
  from: string;
  city?: string;
  foundAt: number;
}

export interface Mission {
  id: string;
  title: string;
  description: string;
  skill: SkillId;
  createdAt: number;
  doneAt?: number;
}

export interface Reflection {
  id: string;
  at: number;
  npcName: string;
  city?: string;
  selfRating: number;
  selfNote?: string;
  headline: string;
  question: string;
  answer?: string;
}

export interface PersonEntry {
  key: string;
  npc: NpcCard;
  persona: Persona;
  expeditionId: string;
  city?: string;
  country?: string;
  lastRapport: number;
  memory: string;
  metAt: number;
  visits: number;
}

export interface AtlasEntry {
  expeditionId: string;
  title: string;
  destination: Destination;
  city?: string;
  country?: string;
  visitedAt: number;
  lenses: LensId[];
  /** Coordinates came from Google search results and passed the 30-day retention limit. */
  coordinatesExpired?: boolean;
}

export interface EncounterState {
  id: string;
  expeditionId: string;
  npcId: string;
  persona: Persona;
  transcript: TranscriptEntry[];
  rapport: number;
  startRapport: number;
  unlockedInsightIds: string[];
  hints: Hint[];
  status: "active" | "ended" | "debriefed";
  endReason?: EndReason;
  startedAt: number;
  memory?: string;
  /** Reply text streaming in right now, if any. */
  streaming: string | null;
  awaiting: boolean;
}

export interface DebriefResult {
  encounterId: string;
  npcId: string;
  npcName: string;
  placeName: string;
  debrief: Debrief;
  xp: { total: number; parts: { label: string; xp: number }[] };
  levelUps: { skill: SkillId; level: string }[];
  rankUp?: string;
  selfRating: number;
  calibrationGap: number | null;
  transcript: TranscriptEntry[];
  insights: Insight[];
}

export interface SaveData {
  version: 1;
  player: PlayerProfile | null;
  settings: Settings;
  progress: Progress;
  journal: { insights: JournalInsight[]; phrases: JournalPhrase[]; missions: Mission[]; reflections: Reflection[] };
  people: PersonEntry[];
  atlas: AtlasEntry[];
  /** Expeditions kept for revisits (most recent first, capped). */
  expeditions: Expedition[];
  active: {
    expeditionId: string | null;
    personas: Record<string, Persona>;
    encounter: EncounterState | null;
    debrief: DebriefResult | null;
  };
}

export interface Toast {
  id: number;
  kind: "info" | "success" | "error" | "insight";
  title: string;
  body?: string;
}

export interface UiState {
  screen: Screen;
  config: AppConfig | null;
  configError: string | null;
  toasts: Toast[];
  /** An expedition on its way: real progress from the server, then the briefing before the locals. */
  busy: { kind: "expedition"; label: string; startedAt: number; progress: StreamProgress | null; briefing: ExpeditionBriefing | null } | null;
  personaStatus: Record<string, "loading" | "ready" | "error">;
  hintLoading: boolean;
  debriefLoading: boolean;
  debriefProgress: StreamProgress | null;
  needsAccessCode: boolean;
}

export interface GameState extends SaveData {
  ui: UiState;
}
