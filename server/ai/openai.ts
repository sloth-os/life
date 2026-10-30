// OpenAI-compatible implementation of the three agents: OpenAI itself or any server speaking
// the Chat Completions API (vLLM, Ollama, OpenRouter, model gateways…). Same prompts as Claude.
//
// Servers differ in structured-output support, so JSON handling degrades gracefully:
// json_schema → json_object → plain text, remembered for the process. Models without
// constrained decoding also drift from the schema, so replies are coerced to it (missing
// fields filled, unknown enum values replaced) before validation; the engine then clamps
// and gates as usual.
import OpenAI from "openai";
import { z } from "zod";
import type { AskRequest, DebriefRequest, HintRequest, MediationDebriefRequest, MediationSceneRequest } from "../../shared/schemas.ts";
import { detectThinkingStyle, type AiTask, type Effort, type JsonMode, type Thinking, type ThinkingStyle } from "../config.ts";
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
  MediationTurnDraftSchema,
  SceneDraftSchema,
  ExpeditionDraftSchema,
  HintDraftSchema,
  NpcTurnDraftSchema,
  PersonaDraftSchema,
  type AskDraft,
  type DebriefDraft,
  type MediationTurnDraft,
  type SceneDraft,
  type ExpeditionDraft,
  type HintDraft,
  type NpcTurnDraft,
  type PersonaDraft,
} from "./schemas.ts";
import { GM_SCENE_SYSTEM, MEDIATION_CONSTITUTION, MENTOR_MEDIATION_SYSTEM, buildMediationMessages, renderMediationDebriefInput, renderSceneBlock, renderSceneInput } from "./mediationPrompts.ts";
import type { ComposeExpeditionInput, CreatePersonaInput, GameAI, MediationTurnInput, NpcTurnInput, OnProgress } from "./types.ts";

const NEXT_MODE: Record<JsonMode, JsonMode | null> = { json_schema: "json_object", json_object: "text", text: null };

type Message = { role: "user" | "assistant"; content: string };
type Json = Record<string, unknown>;

const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

const strictSchemas = new WeakMap<z.ZodType, Json>();

/** A strict-mode JSON Schema: every object closed and fully required, no integer-range noise. */
export function strictJsonSchema(schema: z.ZodType): Json {
  const cached = strictSchemas.get(schema);
  if (cached) return cached;
  const json = z.toJSONSchema(schema) as Json;
  delete json.$schema;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!isRecord(node)) return;
    if (node.type === "integer") {
      delete node.minimum;
      delete node.maximum;
    }
    if (node.type === "object" && isRecord(node.properties)) {
      node.additionalProperties = false;
      node.required = Object.keys(node.properties);
    }
    Object.values(node).forEach(visit);
  };
  visit(json);
  strictSchemas.set(schema, json);
  return json;
}

type Def = { type: string; shape?: Record<string, z.ZodType>; element?: z.ZodType; innerType?: z.ZodType; entries?: Record<string, string> };
const defOf = (schema: z.ZodType) => (schema as unknown as { _zod: { def: Def } })._zod.def;

/** Make a model's reply fit the schema: fill missing fields, fix enum casing or fall back, coerce scalars. */
/** `{}` or `[]`: a reply with nothing in it. */
function isEmptyJson(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  return typeof value === "object" && value !== null && Object.keys(value).length === 0;
}

export function coerceToSchema(schema: z.ZodType, value: unknown): unknown {
  const def = defOf(schema);
  switch (def.type) {
    case "object": {
      const source = isRecord(value) ? value : {};
      return Object.fromEntries(Object.entries(def.shape ?? {}).map(([key, field]) => [key, coerceToSchema(field, source[key])]));
    }
    case "array": {
      const items = Array.isArray(value) ? value : [];
      const element = def.element!;
      if (defOf(element).type === "enum") {
        const options = Object.values(defOf(element).entries ?? {});
        return items.map((item) => matchEnum(options, item)).filter((item): item is string => item !== undefined);
      }
      return items.map((item) => coerceToSchema(element, item));
    }
    case "enum": {
      const options = Object.values(def.entries ?? {});
      return matchEnum(options, value) ?? options[0];
    }
    case "nullable":
      return value === null || value === undefined ? null : coerceToSchema(def.innerType!, value);
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      const finite = Number.isFinite(n) ? n : 0;
      return (schema as unknown as { isInt?: boolean }).isInt ? Math.round(finite) : finite;
    }
    case "string":
      return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
    case "boolean":
      return typeof value === "boolean" ? value : value === "true";
    default:
      return value;
  }
}

function matchEnum(options: string[], value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return options.find((o) => o === value) ?? options.find((o) => o.toLowerCase() === key);
}

/** Drop reasoning some models put in the content (<think>…</think>); "" while still thinking. */
export function stripThinking(text: string): string {
  const withoutClosed = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  const open = withoutClosed.indexOf("<think>");
  return open === -1 ? withoutClosed : withoutClosed.slice(0, open);
}

/** The JSON object in a reply, tolerating code fences and surrounding prose. */
export function extractJson(text: string): unknown {
  const cleaned = stripThinking(text).trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(cleaned);
  const candidate = (fenced ? fenced[1]! : cleaned).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) throw new SyntaxError("no JSON object in the reply");
    return JSON.parse(candidate.slice(start, end + 1));
  }
}

function schemaInstruction(schema: z.ZodType): string {
  return `Respond with one JSON object and nothing else (no markdown, no commentary). It must match this JSON Schema:\n${JSON.stringify(strictJsonSchema(schema))}`;
}

/** Map SDK errors to player-safe HTTP errors (most specific first). */
export function toHttpError(error: unknown): unknown {
  if (error instanceof HttpError) return error;
  if (error instanceof SyntaxError) return new AiOutputError("the reply wasn't valid JSON");
  if (error instanceof OpenAI.APIUserAbortError) return new HttpError(499, "aborted", "Request cancelled.");
  if (error instanceof OpenAI.RateLimitError) return new HttpError(429, "ai_busy", "The locals are swamped right now — try again in a few seconds.");
  if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError) {
    return new HttpError(503, "ai_auth", "The AI service isn't configured correctly (check AI_API_KEY).");
  }
  if (error instanceof OpenAI.BadRequestError) return new HttpError(500, "ai_request", `The AI request was rejected: ${error.message}`);
  if (error instanceof OpenAI.APIConnectionError) return new HttpError(503, "ai_unreachable", "Couldn't reach the AI service. Check your connection and try again.");
  if (error instanceof OpenAI.APIError) return new HttpError(503, "ai_unavailable", "The AI service is temporarily unavailable. Try again shortly.");
  return error;
}

/** The request fields that switch reasoning on or off, by the switch the server reads. */
export function thinkingFields(style: ThinkingStyle, thinking: Thinking, effort: Effort): Record<string, unknown> {
  if (thinking === "model" || style === "none") return {};
  const off = thinking === "off" || effort === "low" || effort === "medium";
  if (style === "qwen") return { enable_thinking: !off };
  return { reasoning_effort: off ? "low" : effort === "high" ? "medium" : "high" };
}

/** Fields the game sends only to save time; a server that rejects one is asked again without it. */
const OPTIONAL_FIELDS = ["enable_thinking", "reasoning_effort", "max_tokens", "max_completion_tokens"] as const;

/** Extra room under the cap for a task that reasons, where servers count reasoning as output. */
export const THINKING_ALLOWANCE = 16_000;
/** Visible characters per token of cap before the game stops a server that ignores the cap. */
const CHARS_PER_TOKEN_GUARD = 6;

/** An answer stopped at its length limit (by the server, or by the game's own guard). */
class CutOff extends Error {
  readonly reasoning: number;
  readonly visible: number;
  constructor(reasoning: number, visible: number) {
    super("the response was cut off");
    this.reasoning = reasoning;
    this.visible = visible;
  }
}

/** OpenAI's reasoning models take max_completion_tokens; most other servers take max_tokens. */
export function tokenFieldFor(model: string): "max_tokens" | "max_completion_tokens" {
  return /^(o[1-9]|gpt-5)/i.test(model) ? "max_completion_tokens" : "max_tokens";
}

export interface OpenAIGameAIOptions {
  client: OpenAI;
  model: string;
  /** Per-task models; the default model for the rest. */
  models?: Partial<Record<AiTask, string>>;
  jsonMode?: JsonMode;
  thinking?: Thinking;
  thinkingStyle?: ThinkingStyle | "auto";
  effort?: Partial<Record<AiTask, Effort>>;
  /** Output caps per task, in tokens (0 or absent: none). */
  maxTokens?: Partial<Record<AiTask, number>>;
  log?: (message: string) => void;
}

interface RunOptions<S extends z.ZodType> {
  task: AiTask;
  schema: S;
  system: string;
  messages: Message[];
  signal?: AbortSignal;
  /** Surface one string field as it is written (the NPC's reply). */
  stream?: { field: string; onValue: (value: string) => void };
  onProgress?: OnProgress;
  /** A retry after a cut-off answer: ask for brevity (and, if it was reasoning that ran long, allow for it). */
  brief?: boolean;
}

export class OpenAIGameAI implements GameAI {
  readonly mode = "openai" as const;
  readonly #opts: OpenAIGameAIOptions;
  #jsonMode: JsonMode;
  readonly #dropped = new Set<string>();
  /** Which field carries the cap, once a server has told us it wants the other one. */
  #tokenField: "max_tokens" | "max_completion_tokens" | null = null;
  /** Tasks whose model reasons even when the game doesn't ask it to: their cap gets the allowance. */
  readonly #reasons = new Set<AiTask>();

  constructor(opts: OpenAIGameAIOptions) {
    this.#opts = opts;
    this.#jsonMode = opts.jsonMode ?? "json_schema";
  }

  get jsonMode(): JsonMode {
    return this.#jsonMode;
  }

  /** Optional fields the server has rejected, which are no longer sent. */
  get droppedFields(): string[] {
    return [...this.#dropped];
  }

  async #run<S extends z.ZodType>(run: RunOptions<S>): Promise<z.infer<S>> {
    for (;;) {
      const mode = this.#jsonMode;
      let body: Record<string, unknown> = {};
      try {
        body = this.#body(run, run.messages, mode);
        let text = await this.#complete(run, body);
        let data: unknown;
        let problem: string | null = null;
        try {
          data = extractJson(text);
          if (isEmptyJson(data)) problem = "That reply was empty. Reply again with the complete JSON object, every field filled in.";
        } catch {
          problem = "That wasn't valid JSON. Reply again with only the JSON object.";
        }
        if (problem) {
          // One repair round: some models wrap or truncate JSON when not constrained, and some now
          // and then answer with an empty object, which coercion would accept as a reply.
          const retry = [...run.messages, { role: "assistant" as const, content: text }, { role: "user" as const, content: problem }];
          text = await this.#complete({ ...run, stream: undefined }, this.#body(run, retry, mode));
          data = extractJson(text);
        }
        const result = run.schema.safeParse(coerceToSchema(run.schema, data));
        if (!result.success) throw new AiOutputError(result.error.issues[0]?.message ?? "invalid reply");
        return result.data;
      } catch (error) {
        if (error instanceof CutOff && !run.brief) {
          // One more try, briefer. If reasoning is what filled the cap, the model reasons on its own: allow for it.
          if (error.reasoning > error.visible) this.#reasons.add(run.task);
          this.#opts.log?.(`[openai] ${run.task}: cut off at the length limit (${error.visible} chars, ${error.reasoning} reasoning); asking again, briefly`);
          run = { ...run, brief: true };
          continue;
        }
        if (error instanceof OpenAI.BadRequestError || error instanceof OpenAI.UnprocessableEntityError) {
          // A rejected speed-up field goes first: the answer format may be fine.
          const field = OPTIONAL_FIELDS.find((f) => f in body && error.message.includes(f));
          if (field === "max_tokens" && error.message.includes("max_completion_tokens")) {
            this.#tokenField = "max_completion_tokens";
            this.#opts.log?.(`[openai] ${run.task}: the server wants max_completion_tokens; sending the cap that way`);
            continue;
          }
          if (field) {
            this.#dropped.add(field);
            this.#opts.log?.(`[openai] ${run.task}: the server rejected ${field} (${error.status}); not sending it again`);
            continue;
          }
          const next = NEXT_MODE[mode];
          if (next) {
            // Concurrent calls can fail on the same mode; step down once, then retry at the current mode.
            if (this.#jsonMode === mode) {
              this.#opts.log?.(`[openai] ${run.task}: the server rejected ${mode} output (${error.status}: ${error.message.slice(0, 200)}); falling back to ${next}`);
              this.#jsonMode = next;
            }
            continue;
          }
          // Plain text was rejected too: a speed-up field the error didn't name is the last suspect.
          const unnamed = OPTIONAL_FIELDS.filter((f) => f in body);
          if (unnamed.length) {
            unnamed.forEach((f) => this.#dropped.add(f));
            this.#opts.log?.(`[openai] ${run.task}: rejected even as plain text; no longer sending ${unnamed.join(", ")}`);
            continue;
          }
        }
        this.#opts.log?.(`[openai] ${run.task} failed: ${error instanceof Error ? error.message.slice(0, 300) : String(error)}`);
        throw toHttpError(error instanceof CutOff ? new AiOutputError("the response was cut off") : error);
      }
    }
  }

  #model(task: AiTask): string {
    return this.#opts.models?.[task] ?? this.#opts.model;
  }

  /** The output cap for a task, with room for reasoning where the model reasons. */
  capFor(task: AiTask, thinking: Record<string, unknown> = {}): number {
    const base = this.#opts.maxTokens?.[task] ?? 0;
    if (!base) return 0;
    const reasons = this.#opts.thinking === "model" || thinking.enable_thinking === true || "reasoning_effort" in thinking || this.#reasons.has(task);
    return base + (reasons ? THINKING_ALLOWANCE : 0);
  }

  #body<S extends z.ZodType>(run: RunOptions<S>, messages: Message[], mode: JsonMode): Record<string, unknown> {
    const model = this.#model(run.task);
    const style = !this.#opts.thinkingStyle || this.#opts.thinkingStyle === "auto" ? detectThinkingStyle(model) : this.#opts.thinkingStyle;
    const thinking = thinkingFields(style, this.#opts.thinking ?? "auto", this.#opts.effort?.[run.task] ?? "medium");
    for (const field of this.#dropped) delete thinking[field];
    const cap = this.capFor(run.task, thinking);
    const tokenField = this.#tokenField ?? tokenFieldFor(model);
    const brevity = run.brief ? "\n\nBe brief: an earlier answer to this request ran past the length limit and was cut off. Keep every text field short and finish the JSON object." : "";
    return {
      model,
      messages: [{ role: "system" as const, content: `${run.system}\n\n${schemaInstruction(run.schema)}${brevity}` }, ...messages],
      ...(mode === "json_schema"
        ? { response_format: { type: "json_schema" as const, json_schema: { name: run.task, schema: strictJsonSchema(run.schema), strict: true } } }
        : mode === "json_object"
          ? { response_format: { type: "json_object" as const } }
          : {}),
      ...thinking,
      ...(cap && !this.#dropped.has(tokenField) ? { [tokenField]: cap } : {}),
    };
  }

  async #complete<S extends z.ZodType>(run: RunOptions<S>, body: Record<string, unknown>): Promise<string> {
    const started = Date.now();
    const { signal, stream, onProgress } = run;
    // Our own guard against a server that ignores the cap: stop reading and cancel the request.
    const cap = Number(body.max_tokens ?? body.max_completion_tokens ?? 0);
    const guard = cap ? cap * CHARS_PER_TOKEN_GUARD : Infinity;
    const local = new AbortController();
    const stopLocal = () => local.abort();
    signal?.addEventListener("abort", stopLocal, { once: true });
    if (signal?.aborted) local.abort();
    // Always stream: some servers only stream thinking models, and a long generation keeps
    // the connection alive instead of idling into a timeout.
    const chunks = await this.#opts.client.chat.completions.create(
      { ...(body as unknown as OpenAI.ChatCompletionCreateParamsStreaming), stream: true },
      { signal: local.signal, timeout: 180_000 },
    );
    let text = "";
    let reasoning = 0;
    let firstToken = 0;
    let finish: string | null | undefined;
    let last = "";
    for await (const chunk of chunks) {
      const choice = chunk.choices[0];
      const delta = choice?.delta as { content?: string | null; refusal?: string | null; reasoning_content?: string | null } | undefined;
      if (delta?.refusal) throw new AiRefusalError(null);
      // Some servers (Qwen, DeepSeek) stream reasoning separately; it counts for progress only.
      reasoning += delta?.reasoning_content?.length ?? 0;
      if (delta?.content) {
        firstToken ||= Date.now() - started;
        text += delta.content;
      }
      finish = choice?.finish_reason ?? finish;
      if (text.length > guard) {
        const visible = stripThinking(text).length;
        if (visible > guard) {
          signal?.removeEventListener("abort", stopLocal);
          local.abort();
          this.#opts.log?.(`[openai] ${run.task} ${String(body.model)} ran past ${guard} chars (cap ${cap} tokens); stopped it`);
          throw new CutOff(reasoning + text.length - visible, visible);
        }
      }
      if (stream || onProgress) {
        const visible = stripThinking(text);
        onProgress?.({ thinking: reasoning + (text.length - visible.length), output: visible });
        if (stream) {
          const value = extractPartialString(visible, stream.field);
          if (value !== null && value !== last) {
            last = value;
            stream.onValue(value);
          }
        }
      }
    }
    signal?.removeEventListener("abort", stopLocal);
    // The SDK ends an aborted stream quietly; don't mistake the partial reply for a finished one.
    if (signal?.aborted) throw new OpenAI.APIUserAbortError();
    const thinking = "enable_thinking" in body ? ` enable_thinking=${String(body.enable_thinking)}` : "reasoning_effort" in body ? ` reasoning_effort=${String(body.reasoning_effort)}` : "";
    this.#opts.log?.(
      `[openai] ${run.task} ${String(body.model)} ${String((body.response_format as { type?: string } | undefined)?.type ?? "text")}${thinking}${cap ? ` cap=${cap}` : ""} first-token=${firstToken}ms total=${Date.now() - started}ms chars=${text.length} reasoning=${reasoning} finish=${finish ?? "?"}`,
    );
    if (finish === "length") {
      const visible = stripThinking(text).length;
      throw new CutOff(reasoning + text.length - visible, visible);
    }
    if (finish === "content_filter") throw new AiRefusalError("content_filter");
    return text;
  }

  composeExpedition(input: ComposeExpeditionInput, signal?: AbortSignal, onProgress?: OnProgress): Promise<ExpeditionDraft> {
    return this.#run({ task: "expedition", schema: ExpeditionDraftSchema, system: GM_EXPEDITION_SYSTEM, messages: [{ role: "user", content: renderExpeditionInput(input) }], signal, onProgress });
  }

  createPersona(input: CreatePersonaInput, signal?: AbortSignal, onProgress?: OnProgress): Promise<PersonaDraft> {
    return this.#run({ task: "persona", schema: PersonaDraftSchema, system: GM_PERSONA_SYSTEM, messages: [{ role: "user", content: renderPersonaInput(input) }], signal, onProgress });
  }

  npcTurn(input: NpcTurnInput, onReply?: (replySoFar: string) => void, signal?: AbortSignal): Promise<NpcTurnDraft> {
    const { context, npc, persona, memory } = input.request;
    const system = `${NPC_CONSTITUTION}\n\n${renderPersonaBlock(context, npc, persona, memory)}`;
    return this.#run({
      task: "turn",
      schema: NpcTurnDraftSchema,
      system,
      messages: buildNpcMessages(input.request, input.turnNumber),
      signal,
      stream: onReply ? { field: "reply", onValue: onReply } : undefined,
    });
  }

  coachHint(request: HintRequest, signal?: AbortSignal): Promise<HintDraft> {
    return this.#run({ task: "hint", schema: HintDraftSchema, system: MENTOR_HINT_SYSTEM, messages: [{ role: "user", content: renderHintInput(request) }], signal });
  }

  debrief(request: DebriefRequest, signal?: AbortSignal, onProgress?: OnProgress): Promise<DebriefDraft> {
    return this.#run({ task: "debrief", schema: DebriefDraftSchema, system: MENTOR_DEBRIEF_SYSTEM, messages: [{ role: "user", content: renderDebriefInput(request) }], signal, onProgress });
  }

  askMentor(request: AskRequest, onAnswer?: (answerSoFar: string) => void, signal?: AbortSignal): Promise<AskDraft> {
    return this.#run({
      task: "ask",
      schema: AskDraftSchema,
      system: MENTOR_ASK_SYSTEM,
      messages: [{ role: "user", content: renderAskInput(request) }],
      signal,
      stream: onAnswer ? { field: "answer", onValue: onAnswer } : undefined,
    });
  }

  createScene(request: MediationSceneRequest, signal?: AbortSignal, onProgress?: OnProgress): Promise<SceneDraft> {
    return this.#run({ task: "scene", schema: SceneDraftSchema, system: GM_SCENE_SYSTEM, messages: [{ role: "user", content: renderSceneInput(request) }], signal, onProgress });
  }

  mediationTurn(input: MediationTurnInput, onReply?: (replySoFar: string) => void, signal?: AbortSignal): Promise<MediationTurnDraft> {
    return this.#run({
      task: "turn",
      schema: MediationTurnDraftSchema,
      system: `${MEDIATION_CONSTITUTION}\n\n${renderSceneBlock(input.request)}`,
      messages: buildMediationMessages(input.request, input.turnNumber, input.wrapUp),
      signal,
      // The first reply's text streams while the rest is written.
      stream: onReply ? { field: "text", onValue: onReply } : undefined,
    });
  }

  mediationDebrief(request: MediationDebriefRequest, signal?: AbortSignal, onProgress?: OnProgress): Promise<DebriefDraft> {
    return this.#run({ task: "debrief", schema: DebriefDraftSchema, system: MENTOR_MEDIATION_SYSTEM, messages: [{ role: "user", content: renderMediationDebriefInput(request) }], signal, onProgress });
  }
}
