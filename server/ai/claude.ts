// Claude implementation of the three agents. Every call streams (so long
// outputs never hit HTTP timeouts), uses structured outputs validated by Zod,
// opts into server-side refusal fallbacks, and caches stable system prompts.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import type { AskRequest, DebriefRequest, HintRequest } from "../../shared/schemas.ts";
import type { AiTask, Effort } from "../config.ts";
import { AiOutputError, AiRefusalError, HttpError } from "../util/errors.ts";
import { extractPartialString } from "./partialJson.ts";
import {
  GM_EXPEDITION_SYSTEM,
  GM_PERSONA_SYSTEM,
  MENTOR_ASK_SYSTEM,
  MENTOR_DEBRIEF_SYSTEM,
  MENTOR_HINT_SYSTEM,
  NPC_CONSTITUTION,
  buildNpcMessages,
  renderAskInput,
  renderDebriefInput,
  renderExpeditionInput,
  renderHintInput,
  renderPersonaBlock,
  renderPersonaInput,
} from "./prompts.ts";
import {
  AskDraftSchema,
  DebriefDraftSchema,
  ExpeditionDraftSchema,
  HintDraftSchema,
  NpcTurnDraftSchema,
  PersonaDraftSchema,
  type AskDraft,
  type DebriefDraft,
  type ExpeditionDraft,
  type HintDraft,
  type NpcTurnDraft,
  type PersonaDraft,
} from "./schemas.ts";
import type { ComposeExpeditionInput, CreatePersonaInput, GameAI, NpcTurnInput, OnProgress } from "./types.ts";

/** Structured outputs on the beta endpoint, plus server-side refusal fallback ("default" routing). */
const BETAS: Anthropic.Beta.AnthropicBeta[] = ["structured-outputs-2025-12-15", "server-side-fallback-2026-07-01"];

const MAX_TOKENS: Record<AiTask, number> = {
  expedition: 16_000,
  persona: 16_000,
  scene: 16_000,
  turn: 8_000,
  hint: 4_000,
  debrief: 16_000,
  ask: 4_000,
};

type SystemBlock = Anthropic.Beta.BetaTextBlockParam;
type Message = Anthropic.Beta.BetaMessageParam;

function cached(text: string): SystemBlock {
  return { type: "text", text, cache_control: { type: "ephemeral" } };
}

export interface ClaudeGameAIOptions {
  client: Anthropic;
  model: string;
  /** Per-task models; the default model for the rest. */
  models?: Partial<Record<AiTask, string>>;
  effort: Record<AiTask, Effort>;
  log?: (message: string) => void;
}

/** Map SDK errors to player-safe HTTP errors (most specific first). */
export function toHttpError(error: unknown): unknown {
  if (error instanceof HttpError) return error;
  if (error instanceof Anthropic.APIUserAbortError) return new HttpError(499, "aborted", "Request cancelled.");
  if (error instanceof Anthropic.RateLimitError) return new HttpError(429, "ai_busy", "The locals are swamped right now — try again in a few seconds.");
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new HttpError(503, "ai_auth", "The AI service isn't configured correctly (check ANTHROPIC_API_KEY).");
  }
  if (error instanceof Anthropic.BadRequestError) return new HttpError(500, "ai_request", `The AI request was rejected: ${error.message}`);
  if (error instanceof Anthropic.APIConnectionError) return new HttpError(503, "ai_unreachable", "Couldn't reach the AI service. Check your connection and try again.");
  if (error instanceof Anthropic.APIError) return new HttpError(503, "ai_unavailable", "The AI service is temporarily unavailable. Try again shortly.");
  return error;
}

export class ClaudeGameAI implements GameAI {
  readonly mode = "claude" as const;
  readonly #opts: ClaudeGameAIOptions;

  constructor(opts: ClaudeGameAIOptions) {
    this.#opts = opts;
  }

  /** Stream a structured response; optionally surface one string field as it is generated. */
  async #run<S extends z.ZodType>(
    task: AiTask,
    schema: S,
    system: SystemBlock[],
    messages: Message[],
    signal?: AbortSignal,
    stream?: { field: string; onValue: (value: string) => void },
    onProgress?: OnProgress,
  ): Promise<z.infer<S>> {
    const format = zodOutputFormat(schema);
    const started = Date.now();
    try {
      const response = this.#opts.client.beta.messages.stream(
        {
          model: this.#opts.models?.[task] ?? this.#opts.model,
          max_tokens: MAX_TOKENS[task],
          betas: BETAS,
          fallbacks: "default",
          system,
          messages,
          cache_control: { type: "ephemeral" },
          // Plain schema only: with a parse-capable format the SDK would parse inside
          // finalMessage(), before we get to check for refusals or truncation.
          output_config: { effort: this.#opts.effort[task], format: { type: "json_schema", schema: format.schema } },
        },
        { signal, timeout: 180_000 },
      );

      if (stream) {
        let last = "";
        response.on("text", (_delta, snapshot) => {
          const value = extractPartialString(snapshot, stream.field);
          if (value !== null && value !== last) {
            last = value;
            stream.onValue(value);
          }
        });
      }
      if (onProgress) {
        let thinking = 0;
        let output = "";
        response.on("thinking", (delta) => {
          thinking += delta.length;
          onProgress({ thinking, output });
        });
        response.on("text", (_delta, snapshot) => {
          output = snapshot;
          onProgress({ thinking, output });
        });
      }

      const message = await response.finalMessage();
      const usage = message.usage;
      this.#opts.log?.(
        `[claude] ${task} ${message.model} ${Date.now() - started}ms in=${usage.input_tokens} cache_read=${usage.cache_read_input_tokens ?? 0} cache_write=${usage.cache_creation_input_tokens ?? 0} out=${usage.output_tokens} stop=${message.stop_reason}`,
      );

      if (message.stop_reason === "refusal") throw new AiRefusalError(message.stop_details?.category ?? null);
      if (message.stop_reason === "max_tokens") throw new AiOutputError("the response was cut off");
      // After a mid-stream fallback the final answer is the last text block.
      const text = message.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").at(-1)?.text ?? "";
      try {
        return format.parse(text);
      } catch (error) {
        throw new AiOutputError(error instanceof Error ? error.message.split("\n")[0]! : "invalid JSON");
      }
    } catch (error) {
      throw toHttpError(error);
    }
  }

  composeExpedition(input: ComposeExpeditionInput, signal?: AbortSignal, onProgress?: OnProgress): Promise<ExpeditionDraft> {
    return this.#run("expedition", ExpeditionDraftSchema, [cached(GM_EXPEDITION_SYSTEM)], [{ role: "user", content: renderExpeditionInput(input) }], signal, undefined, onProgress);
  }

  createPersona(input: CreatePersonaInput, signal?: AbortSignal, onProgress?: OnProgress): Promise<PersonaDraft> {
    return this.#run("persona", PersonaDraftSchema, [cached(GM_PERSONA_SYSTEM)], [{ role: "user", content: renderPersonaInput(input) }], signal, undefined, onProgress);
  }

  npcTurn(input: NpcTurnInput, onReply?: (replySoFar: string) => void, signal?: AbortSignal): Promise<NpcTurnDraft> {
    const { context, npc, persona, memory } = input.request;
    const system = [cached(NPC_CONSTITUTION), cached(renderPersonaBlock(context, npc, persona, memory))];
    return this.#run("turn", NpcTurnDraftSchema, system, buildNpcMessages(input.request, input.turnNumber), signal, onReply ? { field: "reply", onValue: onReply } : undefined);
  }

  coachHint(request: HintRequest, signal?: AbortSignal): Promise<HintDraft> {
    return this.#run("hint", HintDraftSchema, [cached(MENTOR_HINT_SYSTEM)], [{ role: "user", content: renderHintInput(request) }], signal);
  }

  debrief(request: DebriefRequest, signal?: AbortSignal, onProgress?: OnProgress): Promise<DebriefDraft> {
    return this.#run("debrief", DebriefDraftSchema, [cached(MENTOR_DEBRIEF_SYSTEM)], [{ role: "user", content: renderDebriefInput(request) }], signal, undefined, onProgress);
  }

  askMentor(request: AskRequest, onAnswer?: (answerSoFar: string) => void, signal?: AbortSignal): Promise<AskDraft> {
    return this.#run("ask", AskDraftSchema, [cached(MENTOR_ASK_SYSTEM)], [{ role: "user", content: renderAskInput(request) }], signal, onAnswer ? { field: "answer", onValue: onAnswer } : undefined);
  }
}
