import type { DebriefRequest, Destination, HintRequest, PersonaRequest, PlayerContext, TurnRequest } from "../../shared/schemas.ts";
import type { GroundingPack } from "../grounding/index.ts";
import type { DebriefDraft, ExpeditionDraft, HintDraft, NpcTurnDraft, PersonaDraft } from "./schemas.ts";

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

/**
 * The three agents behind the game — Game Master (expedition, persona),
 * Partner (NPC turns) and Mentor (hint, debrief). Implemented by Claude, by any
 * OpenAI-compatible model, or by the scripted demo engine when no AI is configured.
 */
export interface GameAI {
  readonly mode: "claude" | "openai" | "demo";
  composeExpedition(input: ComposeExpeditionInput, signal?: AbortSignal): Promise<ExpeditionDraft>;
  createPersona(input: CreatePersonaInput, signal?: AbortSignal): Promise<PersonaDraft>;
  /** `onReply` receives the reply text decoded so far (a snapshot, not a delta). */
  npcTurn(input: NpcTurnInput, onReply?: (replySoFar: string) => void, signal?: AbortSignal): Promise<NpcTurnDraft>;
  coachHint(request: HintRequest, signal?: AbortSignal): Promise<HintDraft>;
  debrief(request: DebriefRequest, signal?: AbortSignal): Promise<DebriefDraft>;
}
