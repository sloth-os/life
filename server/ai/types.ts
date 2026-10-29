import type { AskRequest, DebriefRequest, Destination, HintRequest, PersonaRequest, PlayerContext, TurnRequest } from "../../shared/schemas.ts";
import type { GroundingPack } from "../grounding/index.ts";
import type { AskDraft, DebriefDraft, ExpeditionDraft, HintDraft, NpcTurnDraft, PersonaDraft } from "./schemas.ts";

export interface ComposeExpeditionInput {
  destination: Destination;
  pack: GroundingPack;
  player: PlayerContext;
  suggestedDifficulty: 1 | 2 | 3;
}

export interface CreatePersonaInput {
  request: PersonaRequest;
  /** Raw grounding if still in the session cache; otherwise the expedition notes suffice. */
  pack?: GroundingPack;
}

export interface NpcTurnInput {
  request: TurnRequest;
  /** 1-based count of player messages including this one. */
  turnNumber: number;
  wrapUp: boolean;
}

/** What a streaming call has produced so far, for progress reports and early results. */
export interface AiProgress {
  /** Characters of reasoning so far (0 when the model doesn't expose it). */
  thinking: number;
  /** The answer so far: partial JSON. */
  output: string;
}
export type OnProgress = (progress: AiProgress) => void;

/**
 * The three agents behind the game — Game Master (expedition, persona),
 * Partner (NPC turns) and Mentor (hint, debrief). Implemented by Claude, by any
 * OpenAI-compatible model, or by the scripted demo engine when no AI is configured.
 */
export interface GameAI {
  readonly mode: "claude" | "openai" | "demo";
  composeExpedition(input: ComposeExpeditionInput, signal?: AbortSignal, onProgress?: OnProgress): Promise<ExpeditionDraft>;
  createPersona(input: CreatePersonaInput, signal?: AbortSignal, onProgress?: OnProgress): Promise<PersonaDraft>;
  /** `onReply` receives the reply text decoded so far (a snapshot, not a delta). */
  npcTurn(input: NpcTurnInput, onReply?: (replySoFar: string) => void, signal?: AbortSignal): Promise<NpcTurnDraft>;
  coachHint(request: HintRequest, signal?: AbortSignal): Promise<HintDraft>;
  debrief(request: DebriefRequest, signal?: AbortSignal, onProgress?: OnProgress): Promise<DebriefDraft>;
  /** A follow-up question about the debrief; `onAnswer` receives the answer written so far. */
  askMentor(request: AskRequest, onAnswer?: (answerSoFar: string) => void, signal?: AbortSignal): Promise<AskDraft>;
}
