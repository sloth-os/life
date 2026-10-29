// The game engine: orchestrates grounding + AI, and is authoritative over the
// rules. The model proposes (rapport changes, insights, scores, quotes); the
// engine validates, clamps and gates before anything reaches the player.
import { randomBytes } from "node:crypto";
import {
  INSIGHT_THRESHOLDS,
  RAPPORT_MIN,
  STARTING_RAPPORT,
  TURN_HARD_CAP,
  TURN_SOFT_CAP,
  applyRapport,
  clamp,
  clampDelta,
  gateInsights,
  suggestedDifficulty,
  initialSkillProfile,
} from "../../shared/rules.ts";
import { SKILL_IDS, isSkillId } from "../../shared/skills.ts";
import { isEmotionId, isLensId, isMoveId, isScenarioId } from "../../shared/world.ts";
import type {
  Debrief,
  DebriefRequest,
  Difficulty,
  EndReason,
  Expedition,
  ExpeditionRequest,
  Hint,
  HintRequest,
  Insight,
  LatLng,
  NpcCard,
  Persona,
  PersonaRequest,
  TurnRequest,
  TurnResult,
} from "../../shared/schemas.ts";
import { hashString } from "../ai/demo.ts";
import type { DebriefDraft, ExpeditionDraft, HintDraft, InsightDraft, NpcTurnDraft, PersonaDraft } from "../ai/schemas.ts";
import type { GameAI } from "../ai/types.ts";
import type { GroundingPack, GroundingService } from "../grounding/index.ts";
import { AiOutputError, HttpError } from "../util/errors.ts";

const trim = (value: string | undefined | null, max: number): string => (value ?? "").trim().slice(0, max);

/** Spread locals without a mapped place ~150–300 m around the centre so markers don't overlap. */
export function offsetPoint(center: LatLng, index: number): LatLng {
  const angle = (index * 2.4 + 0.6) % (2 * Math.PI);
  const meters = 150 + index * 70;
  const dLat = (meters * Math.cos(angle)) / 111_320;
  const dLng = (meters * Math.sin(angle)) / (111_320 * Math.max(0.2, Math.cos((center.lat * Math.PI) / 180)));
  return { lat: center.lat + dLat, lng: center.lng + dLng };
}

export function finalizeExpedition(draft: ExpeditionDraft, pack: GroundingPack, request: ExpeditionRequest, aiMode: GameAI["mode"], now = Date.now()): Expedition {
  if (draft.npcs.length === 0) throw new AiOutputError("no locals were created");
  const npcs: NpcCard[] = draft.npcs.slice(0, 3).map((n, i) => {
    const place = n.place_source_id ? pack.places.find((p) => p.sourceId === n.place_source_id) : undefined;
    const name = trim(n.name, 60) || `Local ${i + 1}`;
    return {
      id: `npc-${i + 1}`,
      name,
      age: clamp(Math.round(n.age || 30), 16, 95),
      role: trim(n.role, 80) || "local resident",
      placeName: trim(place?.name ?? n.place_name, 120) || pack.label,
      placeSourceId: place?.sourceId,
      location: place?.location ?? offsetPoint(pack.center, i),
      mapsUrl: place?.kind === "google_place" ? place.mapsUrl : undefined,
      lens: isLensId(n.lens) ? n.lens : "society",
      scenario: isScenarioId(n.scenario) ? n.scenario : "conversation",
      difficulty: clamp(Math.round(n.difficulty || 1), 1, 3) as Difficulty,
      hook: trim(n.hook, 240),
      goal: trim(n.goal, 200) || `Get to know ${name}`,
      hue: hashString(name) % 360,
    };
  });
  const pick = (packValue: string | undefined, draftValue: string) => trim(packValue || draftValue, 120) || undefined;
  return {
    id: `exp_${now.toString(36)}_${randomBytes(3).toString("hex")}`,
    createdAt: now,
    mapsMode: pack.mapsMode,
    aiMode,
    destination: request.destination,
    locality: {
      city: pick(pack.locality.city, draft.locality.city),
      region: pick(pack.locality.region, draft.locality.region),
      country: pick(pack.locality.country, draft.locality.country),
    },
    title: trim(draft.title, 120) || pack.label,
    scene: trim(draft.scene, 800),
    weather: pack.weather,
    greeting: {
      language: trim(draft.greeting.language, 60) || "the local language",
      phrase: trim(draft.greeting.phrase, 80) || "Hello",
      meaning: trim(draft.greeting.meaning, 160),
      pronunciation: trim(draft.greeting.pronunciation, 80) || undefined,
    },
    curiosity: draft.curiosity.slice(0, 3).map((q) => trim(q, 200)).filter(Boolean),
    npcs,
    sources: pack.sources.slice(0, 40),
    notes: trim(draft.notes, 6000),
  };
}

export function normalizeQuiz(quiz: InsightDraft["quiz"]): Insight["quiz"] {
  const correct = trim(quiz.options[quiz.answer_index] ?? quiz.options[0], 140);
  const options = [...new Set(quiz.options.map((o) => trim(o, 140)).filter(Boolean))].slice(0, 4);
  if (correct && !options.includes(correct)) options[options.length ? options.length - 1 : 0] = correct;
  while (options.length < 2) options.push(options.length === 0 ? correct || "—" : "None of the above");
  return { question: trim(quiz.question, 200), options, answerIndex: Math.max(0, options.indexOf(correct)) };
}

export function finalizePersona(draft: PersonaDraft, npc: NpcCard): Persona {
  const insights: Insight[] = draft.insights.slice(0, 3).map((ins, i) => ({
    id: `i${i + 1}`,
    lens: isLensId(ins.lens) ? ins.lens : npc.lens,
    title: trim(ins.title, 100),
    fact: trim(ins.fact, 500),
    threshold: INSIGHT_THRESHOLDS[i] ?? 75,
    sourceIds: ins.source_ids.map((s) => trim(s, 12)).filter((s) => /^(P|W)\d+$|^WX$/.test(s)).slice(0, 4),
    quiz: normalizeQuiz(ins.quiz),
  }));
  return {
    npcId: npc.id,
    name: npc.name,
    age: npc.age,
    role: npc.role,
    pronouns: trim(draft.pronouns, 30) || "they/them",
    placeName: npc.placeName,
    personality: trim(draft.personality, 400),
    communicationStyle: trim(draft.communication_style, 300),
    background: trim(draft.background, 600),
    currentSituation: trim(draft.current_situation, 400),
    hiddenConcern: trim(draft.hidden_concern, 300),
    boundaries: draft.boundaries.slice(0, 4).map((b) => trim(b, 200)).filter(Boolean),
    languageNotes: trim(draft.language_notes, 300),
    scenarioBrief: trim(draft.scenario_brief, 500),
    openingLine: trim(draft.opening_line, 400) || "Hello?",
    openingGesture: trim(draft.opening_gesture, 160),
    startingRapport: STARTING_RAPPORT[npc.difficulty],
    insights,
  };
}

export function resolveTurn(request: TurnRequest, draft: NpcTurnDraft, turnNumber: number): TurnResult {
  const rapportDelta = clampDelta(draft.rapport_delta);
  const rapport = applyRapport(request.rapport, rapportDelta);
  const revealedInsightIds = gateInsights(draft.revealed_insight_ids, request.persona.insights, request.unlockedInsightIds, rapport);
  const moves = [...new Set(draft.perceived_moves)].filter(isMoveId).slice(0, 6);
  let ended = draft.conversation_state === "ended";
  let endReason: EndReason | undefined;
  if (rapport <= RAPPORT_MIN) {
    ended = true;
    endReason = "walked_away";
  } else if (ended) {
    endReason = moves.includes("farewell") || rapportDelta >= 0 ? "farewell" : "walked_away";
  } else if (turnNumber >= TURN_HARD_CAP) {
    ended = true;
    endReason = "turn_limit";
  }
  const phrase = draft.phrase && draft.phrase.text.trim() ? { text: trim(draft.phrase.text, 80), meaning: trim(draft.phrase.meaning, 160) } : null;
  return {
    reply: trim(draft.reply, 1200) || "…",
    gesture: trim(draft.gesture, 200),
    emotion: isEmotionId(draft.emotion) ? draft.emotion : "neutral",
    rapportDelta,
    rapport,
    moves,
    innerThought: trim(draft.inner_thought, 400),
    revealedInsightIds,
    phrase,
    ended,
    endReason,
    wrapUp: turnNumber >= TURN_SOFT_CAP,
  };
}

const normalizeForMatch = (s: string) =>
  s
    .toLowerCase()
    .replace(/[“”"'‘’`…]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Strip wrapping quotes/ellipses the model may add, keeping the learner's words. */
function cleanQuote(quote: string): string {
  return quote.trim().replace(/^[“"'‘…\s]+|[”"'’…\s]+$/g, "");
}

export function isVerbatim(quote: string, lines: string[]): boolean {
  const q = normalizeForMatch(cleanQuote(quote));
  return q.length >= 3 && lines.some((line) => normalizeForMatch(line).includes(q));
}

function closestLine(text: string, lines: string[]): string {
  const words = new Set(normalizeForMatch(text).split(" "));
  let best = lines[0] ?? "";
  let bestScore = -1;
  for (const line of lines) {
    const score = normalizeForMatch(line)
      .split(" ")
      .filter((w) => words.has(w)).length;
    if (score > bestScore) {
      best = line;
      bestScore = score;
    }
  }
  return best;
}

export function finalizeDebrief(draft: DebriefDraft, request: DebriefRequest): Debrief {
  const lines = request.transcript.filter((e) => e.speaker === "player").map((e) => e.text);
  const scores = {} as Debrief["scores"];
  for (const id of SKILL_IDS) {
    const value = draft.scores[id];
    scores[id] = typeof value === "number" && Number.isFinite(value) ? clamp(Math.round(value), 0, 4) : null;
  }
  const evidence = draft.evidence
    .filter((e) => isSkillId(e.skill) && isVerbatim(e.quote, lines))
    .slice(0, 6)
    .map((e) => ({ skill: e.skill, quote: trim(cleanQuote(e.quote), 300), note: trim(e.note, 300), positive: e.positive }));
  const original = isVerbatim(draft.growth.original, lines) ? cleanQuote(draft.growth.original) : closestLine(draft.growth.original, lines);
  return {
    headline: trim(draft.headline, 140),
    summary: trim(draft.summary, 800),
    scores,
    evidence,
    strengths: draft.strengths.slice(0, 3).map((s) => trim(s, 300)).filter(Boolean),
    growth: {
      skill: isSkillId(draft.growth.skill) ? draft.growth.skill : request.player.focusSkill,
      tip: trim(draft.growth.tip, 400),
      original: trim(original, 600),
      rewrite: trim(draft.growth.rewrite, 600),
    },
    calibration: trim(draft.calibration, 400),
    reflectionQuestion: trim(draft.reflection_question, 300),
    fieldMission: {
      title: trim(draft.field_mission.title, 80),
      description: trim(draft.field_mission.description, 400),
      skill: isSkillId(draft.field_mission.skill) ? draft.field_mission.skill : request.player.focusSkill,
    },
    goalAchieved: Boolean(draft.goal_achieved),
    memory: trim(draft.memory, 500),
  };
}

function finalizeHint(draft: HintDraft, request: HintRequest): Hint {
  return {
    skill: isSkillId(draft.skill) ? draft.skill : request.player.focusSkill,
    observation: trim(draft.observation, 300),
    suggestion: trim(draft.suggestion, 400),
    example: trim(draft.example, 200).replace(/^[“"]|[”"]$/g, ""),
  };
}

export interface GameEngineDeps {
  ai: GameAI;
  grounding: GroundingService;
}

export class GameEngine {
  readonly #deps: GameEngineDeps;

  constructor(deps: GameEngineDeps) {
    this.#deps = deps;
  }

  get aiMode(): GameAI["mode"] {
    return this.#deps.ai.mode;
  }

  async createExpedition(request: ExpeditionRequest, signal?: AbortSignal): Promise<Expedition> {
    const pack = await this.#deps.grounding.gather(request.destination);
    const profile = initialSkillProfile();
    for (const id of SKILL_IDS) profile[id].rating = request.player.skills[id] ?? profile[id].rating;
    const draft = await this.#deps.ai.composeExpedition({ destination: request.destination, pack, player: request.player, suggestedDifficulty: suggestedDifficulty(profile) }, signal);
    const expedition = finalizeExpedition(draft, pack, request, this.#deps.ai.mode);
    this.#deps.grounding.remember(expedition.id, pack);
    return expedition;
  }

  async createPersona(request: PersonaRequest, signal?: AbortSignal): Promise<Persona> {
    const pack = this.#deps.grounding.cached(request.context.expeditionId);
    const draft = await this.#deps.ai.createPersona({ request, pack }, signal);
    const persona = finalizePersona(draft, request.npc);
    if (persona.insights.length === 0) throw new AiOutputError("the local has nothing to share");
    return persona;
  }

  async turn(request: TurnRequest, onReply?: (replySoFar: string) => void, signal?: AbortSignal): Promise<TurnResult> {
    const turnNumber = request.transcript.filter((e) => e.speaker === "player").length + 1;
    if (turnNumber > TURN_HARD_CAP) throw new HttpError(409, "encounter_over", "This conversation has already ended.");
    const draft = await this.#deps.ai.npcTurn({ request, turnNumber, wrapUp: turnNumber >= TURN_SOFT_CAP }, onReply, signal);
    return resolveTurn(request, draft, turnNumber);
  }

  async hint(request: HintRequest, signal?: AbortSignal): Promise<Hint> {
    return finalizeHint(await this.#deps.ai.coachHint(request, signal), request);
  }

  async debrief(request: DebriefRequest, signal?: AbortSignal): Promise<Debrief> {
    return finalizeDebrief(await this.#deps.ai.debrief(request, signal), request);
  }
}
