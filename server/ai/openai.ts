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
import type { DebriefRequest, HintRequest } from "../../shared/schemas.ts";
import type { JsonMode } from "../config.ts";
import { AiOutputError, AiRefusalError, HttpError } from "../util/errors.ts";
import { extractPartialString } from "./partialJson.ts";
import {
  GM_EXPEDITION_SYSTEM,
  GM_PERSONA_SYSTEM,
  MENTOR_DEBRIEF_SYSTEM,
  MENTOR_HINT_SYSTEM,
  NPC_CONSTITUTION,
  buildNpcMessages,
  renderDebriefInput,
  renderExpeditionInput,
  renderHintInput,
  renderPersonaBlock,
  renderPersonaInput,
} from "./prompts.ts";
import {
  DebriefDraftSchema,
  ExpeditionDraftSchema,
  HintDraftSchema,
  NpcTurnDraftSchema,
  PersonaDraftSchema,
  type DebriefDraft,
  type ExpeditionDraft,
  type HintDraft,
  type NpcTurnDraft,
  type PersonaDraft,
} from "./schemas.ts";
import type { ComposeExpeditionInput, CreatePersonaInput, GameAI, NpcTurnInput } from "./types.ts";

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

export interface OpenAIGameAIOptions {
  client: OpenAI;
  model: string;
  jsonMode?: JsonMode;
  log?: (message: string) => void;
}

export class OpenAIGameAI implements GameAI {
  readonly mode = "openai" as const;
  readonly #opts: OpenAIGameAIOptions;
  #jsonMode: JsonMode;

  constructor(opts: OpenAIGameAIOptions) {
    this.#opts = opts;
    this.#jsonMode = opts.jsonMode ?? "json_schema";
  }

  get jsonMode(): JsonMode {
    return this.#jsonMode;
  }

  async #run<S extends z.ZodType>(
    task: string,
    schema: S,
    system: string,
    messages: Message[],
    signal?: AbortSignal,
    stream?: { field: string; onValue: (value: string) => void },
  ): Promise<z.infer<S>> {
    for (;;) {
      const mode = this.#jsonMode;
      try {
        let text = await this.#complete(task, schema, system, messages, mode, signal, stream);
        let data: unknown;
        try {
          data = extractJson(text);
        } catch {
          // One repair round: some models wrap or truncate JSON when not constrained.
          text = await this.#complete(task, schema, system, [...messages, { role: "assistant", content: text }, { role: "user", content: "That wasn't valid JSON. Reply again with only the JSON object." }], mode, signal);
          data = extractJson(text);
        }
        const result = schema.safeParse(coerceToSchema(schema, data));
        if (!result.success) throw new AiOutputError(result.error.issues[0]?.message ?? "invalid reply");
        return result.data;
      } catch (error) {
        const next = NEXT_MODE[mode];
        if (next && (error instanceof OpenAI.BadRequestError || error instanceof OpenAI.UnprocessableEntityError)) {
          // Concurrent calls can fail on the same mode; step down once, then retry at the current mode.
          if (this.#jsonMode === mode) {
            this.#opts.log?.(`[openai] ${task}: the server rejected ${mode} output (${error.status}: ${error.message.slice(0, 200)}); falling back to ${next}`);
            this.#jsonMode = next;
          }
          continue;
        }
        this.#opts.log?.(`[openai] ${task} failed: ${error instanceof Error ? error.message.slice(0, 300) : String(error)}`);
        throw toHttpError(error);
      }
    }
  }

  async #complete(task: string, schema: z.ZodType, system: string, messages: Message[], mode: JsonMode, signal?: AbortSignal, stream?: { field: string; onValue: (value: string) => void }): Promise<string> {
    const started = Date.now();
    const body = {
      model: this.#opts.model,
      messages: [{ role: "system" as const, content: `${system}\n\n${schemaInstruction(schema)}` }, ...messages],
      ...(mode === "json_schema"
        ? { response_format: { type: "json_schema" as const, json_schema: { name: task, schema: strictJsonSchema(schema), strict: true } } }
        : mode === "json_object"
          ? { response_format: { type: "json_object" as const } }
          : {}),
    };
    // Always stream: some servers only stream thinking models, and a long generation keeps
    // the connection alive instead of idling into a timeout.
    const chunks = await this.#opts.client.chat.completions.create({ ...body, stream: true }, { signal, timeout: 180_000 });
    let text = "";
    let reasoning = 0;
    let firstToken = 0;
    let finish: string | null | undefined;
    let last = "";
    for await (const chunk of chunks) {
      const choice = chunk.choices[0];
      const delta = choice?.delta as { content?: string | null; refusal?: string | null; reasoning_content?: string | null } | undefined;
      if (delta?.refusal) throw new AiRefusalError(null);
      // Some servers (Qwen, DeepSeek) stream reasoning separately; it only counts for the log.
      reasoning += delta?.reasoning_content?.length ?? 0;
      if (delta?.content) {
        firstToken ||= Date.now() - started;
        text += delta.content;
      }
      finish = choice?.finish_reason ?? finish;
      if (stream) {
        const value = extractPartialString(stripThinking(text), stream.field);
        if (value !== null && value !== last) {
          last = value;
          stream.onValue(value);
        }
      }
    }
    // The SDK ends an aborted stream quietly; don't mistake the partial reply for a finished one.
    if (signal?.aborted) throw new OpenAI.APIUserAbortError();
    this.#opts.log?.(`[openai] ${task} ${this.#opts.model} ${mode} first-token=${firstToken}ms total=${Date.now() - started}ms chars=${text.length} reasoning=${reasoning} finish=${finish ?? "?"}`);
    if (finish === "length") throw new AiOutputError("the response was cut off");
    if (finish === "content_filter") throw new AiRefusalError("content_filter");
    return text;
  }

  composeExpedition(input: ComposeExpeditionInput, signal?: AbortSignal): Promise<ExpeditionDraft> {
    return this.#run("expedition", ExpeditionDraftSchema, GM_EXPEDITION_SYSTEM, [{ role: "user", content: renderExpeditionInput(input) }], signal);
  }

  createPersona(input: CreatePersonaInput, signal?: AbortSignal): Promise<PersonaDraft> {
    return this.#run("persona", PersonaDraftSchema, GM_PERSONA_SYSTEM, [{ role: "user", content: renderPersonaInput(input) }], signal);
  }

  npcTurn(input: NpcTurnInput, onReply?: (replySoFar: string) => void, signal?: AbortSignal): Promise<NpcTurnDraft> {
    const { context, npc, persona, memory } = input.request;
    const system = `${NPC_CONSTITUTION}\n\n${renderPersonaBlock(context, npc, persona, memory)}`;
    return this.#run("turn", NpcTurnDraftSchema, system, buildNpcMessages(input.request, input.turnNumber), signal, onReply ? { field: "reply", onValue: onReply } : undefined);
  }

  coachHint(request: HintRequest, signal?: AbortSignal): Promise<HintDraft> {
    return this.#run("hint", HintDraftSchema, MENTOR_HINT_SYSTEM, [{ role: "user", content: renderHintInput(request) }], signal);
  }

  debrief(request: DebriefRequest, signal?: AbortSignal): Promise<DebriefDraft> {
    return this.#run("debrief", DebriefDraftSchema, MENTOR_DEBRIEF_SYSTEM, [{ role: "user", content: renderDebriefInput(request) }], signal);
  }
}
