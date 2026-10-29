// Game rules shared by the server (authoritative for rapport + insight gating)
// and the client (progression, XP, spaced review). Pure functions only.
import { SKILL_IDS, type SkillId } from "./skills.ts";

// ── Rapport ───────────────────────────────────────────────────────────────
export const RAPPORT_MIN = 0;
export const RAPPORT_MAX = 100;
export const RAPPORT_DELTA_MIN = -15;
export const RAPPORT_DELTA_MAX = 12;
/** Rapport needed for insight 1, 2, 3. */
export const INSIGHT_THRESHOLDS = [30, 55, 75] as const;
export const HIDDEN_CONCERN_HINT_AT = 60;
export const HIDDEN_CONCERN_REVEAL_AT = 75;
export const STARTING_RAPPORT: Record<1 | 2 | 3, number> = { 1: 22, 2: 14, 3: 6 };

/** Player messages per encounter: the NPC starts wrapping up at the soft cap. */
export const TURN_SOFT_CAP = 12;
export const TURN_HARD_CAP = 16;
export const HINTS_PER_ENCOUNTER = 3;
export const PLAYER_MESSAGE_MAX = 600;

export type RapportTier = "Stranger" | "Acquainted" | "Warm" | "Trusted";

export function rapportTier(rapport: number): RapportTier {
  if (rapport >= 75) return "Trusted";
  if (rapport >= 50) return "Warm";
  if (rapport >= 25) return "Acquainted";
  return "Stranger";
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampDelta(delta: number): number {
  if (!Number.isFinite(delta)) return 0;
  return clamp(Math.round(delta), RAPPORT_DELTA_MIN, RAPPORT_DELTA_MAX);
}

export function applyRapport(rapport: number, delta: number): number {
  return clamp(rapport + clampDelta(delta), RAPPORT_MIN, RAPPORT_MAX);
}

/**
 * Accept at most one newly revealed insight per reply, and only if the
 * rapport after this turn meets its threshold.
 */
export function gateInsights(
  proposedIds: readonly string[],
  insights: readonly { id: string; threshold: number }[],
  alreadyUnlocked: readonly string[],
  rapportAfter: number,
): string[] {
  for (const id of proposedIds) {
    if (alreadyUnlocked.includes(id)) continue;
    const insight = insights.find((i) => i.id === id);
    if (insight && rapportAfter >= insight.threshold) return [id];
  }
  return [];
}

// ── Skills ────────────────────────────────────────────────────────────────
export interface SkillProgress {
  rating: number;
  evidence: number;
  history: number[];
}

export type SkillProfile = Record<SkillId, SkillProgress>;

export function initialSkillProfile(focus?: SkillId): SkillProfile {
  const profile = {} as SkillProfile;
  for (const id of SKILL_IDS) profile[id] = { rating: id === focus ? 15 : 20, evidence: 0, history: [] };
  return profile;
}

/** Move a skill rating toward 25·score with an EMA; faster while evidence is scarce. */
export function updateSkill(progress: SkillProgress, score: number | null | undefined): SkillProgress {
  if (score === null || score === undefined || !Number.isFinite(score)) return progress;
  const s = clamp(Math.round(score), 0, 4);
  const alpha = progress.evidence < 3 ? 0.35 : 0.2;
  const rating = Math.round(progress.rating + alpha * (s * 25 - progress.rating));
  return { rating, evidence: progress.evidence + 1, history: [...progress.history, rating].slice(-30) };
}

export function weakestSkill(profile: SkillProfile): SkillId {
  let weakest: SkillId = SKILL_IDS[0];
  for (const id of SKILL_IDS) if (profile[id].rating < profile[weakest].rating) weakest = id;
  return weakest;
}

/** Suggested difficulty for a new local from the learner's average rating. */
export function suggestedDifficulty(profile: SkillProfile): 1 | 2 | 3 {
  const avg = SKILL_IDS.reduce((sum, id) => sum + profile[id].rating, 0) / SKILL_IDS.length;
  if (avg >= 55) return 3;
  if (avg >= 35) return 2;
  return 1;
}

// ── XP & ranks ────────────────────────────────────────────────────────────
export const RANKS = [
  { name: "Newcomer", xp: 0 },
  { name: "Visitor", xp: 150 },
  { name: "Traveler", xp: 400 },
  { name: "Wayfarer", xp: 800 },
  { name: "Bridge-builder", xp: 1400 },
  { name: "Global Neighbor", xp: 2200 },
] as const;

export function rankFor(xp: number): { name: string; index: number; floor: number; next: number | null } {
  let index = 0;
  for (let i = 0; i < RANKS.length; i++) if (xp >= RANKS[i]!.xp) index = i;
  const next = RANKS[index + 1];
  return { name: RANKS[index]!.name, index, floor: RANKS[index]!.xp, next: next ? next.xp : null };
}

export interface EncounterXpInput {
  rapportGained: number;
  insights: number;
  goalAchieved: boolean;
  scores: Partial<Record<SkillId, number | null>>;
  reflected: boolean;
}

export function encounterXp(input: EncounterXpInput): { total: number; parts: { label: string; xp: number }[] } {
  const scoreSum = Object.values(input.scores).reduce<number>((sum, s) => sum + (typeof s === "number" ? s : 0), 0);
  const parts = [
    { label: "Rapport built", xp: Math.max(0, Math.round(input.rapportGained)) },
    { label: "Insights discovered", xp: input.insights * 15 },
    { label: "Goal achieved", xp: input.goalAchieved ? 30 : 0 },
    { label: "Skills shown", xp: Math.round(scoreSum * 5) },
    { label: "Reflection", xp: input.reflected ? 10 : 0 },
  ].filter((p) => p.xp > 0);
  return { total: parts.reduce((sum, p) => sum + p.xp, 0), parts };
}

// ── Calibration (self-assessment vs mentor) ──────────────────────────────
/** Self rating 1..5 maps to 0..4. Positive = learner rated themselves higher than the mentor. */
export function calibrationGap(selfRating: number, scores: Partial<Record<SkillId, number | null>>): number | null {
  const values = Object.values(scores).filter((s): s is number => typeof s === "number");
  if (values.length === 0) return null;
  const mentorMean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.round((clamp(selfRating, 1, 5) - 1 - mentorMean) * 10) / 10;
}

// ── Spaced recall (Leitner boxes) ────────────────────────────────────────
export const LEITNER_INTERVAL_DAYS = [0, 1, 3, 7, 16] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RecallState {
  box: number;
  dueAt: number;
}

export function scheduleRecall(state: RecallState, correct: boolean, now: number): RecallState {
  const box = correct ? Math.min(state.box + 1, LEITNER_INTERVAL_DAYS.length) : 1;
  return { box, dueAt: now + LEITNER_INTERVAL_DAYS[box - 1]! * DAY_MS };
}

export function isDue(state: RecallState, now: number): boolean {
  return state.dueAt <= now;
}

/** Google Maps coordinates may be cached for at most 30 days. */
export const MAPS_COORDINATE_RETENTION_MS = 30 * DAY_MS;

// ── Mediation scenes ──────────────────────────────────────────────────────
/** Each party starts neutral towards the learner, who is a stranger stepping in. */
export const MEDIATION_STARTING_RAPPORT = 45;
export const TENSION_DELTA_MIN = -15;
export const TENSION_DELTA_MAX = 15;
/** They can settle only once tension has come down this far and both trust the learner this much. */
export const AGREEMENT_TENSION_MAX = 45;
export const AGREEMENT_RAPPORT_MIN = 40;
/** Past this, one of them walks off. */
export const WALKOUT_TENSION = 95;
export const MEDIATION_TURN_SOFT_CAP = 10;
export const MEDIATION_TURN_HARD_CAP = 14;
