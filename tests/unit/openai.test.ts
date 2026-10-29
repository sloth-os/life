// Exercises OpenAIGameAI through the real OpenAI SDK with a fake fetch: the request we send,
// streaming, and how it copes with servers and models that only half-support structured output.
import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { OpenAIGameAI, coerceToSchema, extractJson, strictJsonSchema } from "../../server/ai/openai.ts";
import { NpcTurnDraftSchema, type NpcTurnDraft } from "../../server/ai/schemas.ts";
import { resolveAi } from "../../server/config.ts";
import { HttpError } from "../../server/util/errors.ts";
import { context, npc, player, turnRequest } from "./fixtures.ts";

interface Call {
  url: string;
  body: Record<string, unknown>;
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

/** A streamed chat completion, optionally with reasoning streamed separately (as Qwen does). */
function streamed(content: string, finish = "stop", reasoning = "") {
  const pieces = content.match(/.{1,6}/gs) ?? [];
  const chunk = (delta: Record<string, unknown>, finishReason: string | null = null) =>
    `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 1, model: "qwen3.8-max", choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`;
  const body = [
    chunk({ role: "assistant", content: "" }),
    ...(reasoning ? [chunk({ reasoning_content: reasoning })] : []),
    ...pieces.map((p) => chunk({ content: p })),
    chunk({}, finish),
    "data: [DONE]\n\n",
  ].join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function setup(respond: (call: Call, index: number) => Response) {
  const calls: Call[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> };
    calls.push(call);
    return respond(call, calls.length - 1);
  };
  const client = new OpenAI({ apiKey: "test-key", baseURL: "https://gateway.test/v1", fetch: fetchImpl as typeof fetch, maxRetries: 0 });
  const logs: string[] = [];
  return { ai: new OpenAIGameAI({ client, model: "qwen3.8-max", log: (m) => logs.push(m) }), calls, logs };
}

const turnDraft: NpcTurnDraft = {
  reply: "Mangoes, mostly — and gossip. What brings you here?",
  gesture: "laughs",
  emotion: "warm",
  rapport_delta: 6,
  perceived_moves: ["greeting", "open_question"],
  inner_thought: "A real question.",
  revealed_insight_ids: [],
  phrase: { text: "Karibu", meaning: "Welcome" },
  conversation_state: "ongoing",
};

describe("OpenAIGameAI", () => {
  it("asks for strict JSON-schema output and streams the reply", async () => {
    const { ai, calls } = setup(() => streamed(JSON.stringify(turnDraft)));
    const snapshots: string[] = [];
    const draft = await ai.npcTurn({ request: turnRequest(), turnNumber: 1, wrapUp: false }, (s) => snapshots.push(s));
    expect(draft).toEqual(turnDraft);
    expect(snapshots.at(-1)).toBe(turnDraft.reply);
    expect(snapshots.length).toBeGreaterThan(2);

    const [call] = calls;
    expect(call!.url).toBe("https://gateway.test/v1/chat/completions");
    const body = call!.body as { model: string; stream: boolean; messages: { role: string; content: string }[]; response_format: { type: string; json_schema: { name: string; strict: boolean; schema: { additionalProperties: boolean; required: string[] } } } };
    expect(body).toMatchObject({ model: "qwen3.8-max", stream: true });
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema).toMatchObject({ name: "turn", strict: true });
    expect(body.response_format.json_schema.schema.additionalProperties).toBe(false);
    expect(body.response_format.json_schema.schema.required).toContain("inner_thought");
    expect(body.messages[0]!.role).toBe("system");
    expect(body.messages[0]!.content).toContain("Rapport is earned");
    expect(body.messages[0]!.content).toContain("You are Wanjiru");
    expect(body.messages[0]!.content).toContain("JSON Schema");
    expect(body.messages.at(-1)!.content).toContain("<player>");
  });

  it("falls back to JSON mode when the server rejects json_schema, and remembers it", async () => {
    const { ai, calls, logs } = setup((call) =>
      (call.body.response_format as { type?: string } | undefined)?.type === "json_schema"
        ? json({ error: { message: "response_format json_schema is not supported", type: "invalid_request_error" } }, 400)
        : streamed(JSON.stringify({ skill: "listening", observation: "o", suggestion: "s", example: "e" })),
    );
    await expect(ai.coachHint(turnRequest())).resolves.toMatchObject({ skill: "listening" });
    await ai.coachHint(turnRequest());
    expect(calls.map((c) => (c.body.response_format as { type: string }).type)).toEqual(["json_schema", "json_object", "json_object"]);
    expect(calls.every((c) => c.body.stream === true)).toBe(true);
    expect(ai.jsonMode).toBe("json_object");
    expect(logs.some((l) => l.includes("falling back to json_object"))).toBe(true);
  });

  it("copes with thinking tags, code fences and loose enum values", async () => {
    const reply = `<think>They asked about mangoes.</think>Sure!\n\`\`\`json\n${JSON.stringify({ ...turnDraft, emotion: "Warm", perceived_moves: ["open question", "made_up"], rapport_delta: "7" })}\n\`\`\``;
    const { ai, logs } = setup(() => streamed(reply, "stop", "Thinking about mangoes."));
    const draft = await ai.npcTurn({ request: turnRequest(), turnNumber: 1, wrapUp: false });
    expect(draft).toMatchObject({ emotion: "warm", perceived_moves: ["open_question"], rapport_delta: 7 });
    expect(logs[0]).toMatch(/turn qwen3\.8-max json_schema first-token=\d+ms total=\d+ms .* reasoning=23 finish=stop/);
  });

  it("asks again once when the reply isn't JSON at all", async () => {
    const { ai, calls } = setup((_call, i) => (i === 0 ? streamed("Happy to help — here you go!") : streamed(JSON.stringify({ skill: "empathy", observation: "o", suggestion: "s", example: "e" }))));
    await expect(ai.coachHint(turnRequest())).resolves.toMatchObject({ skill: "empathy" });
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls[1]!.body.messages)).toContain("wasn't valid JSON");
  });

  it("steps down once when concurrent calls hit the same rejection", async () => {
    const { ai, calls, logs } = setup((call) =>
      (call.body.response_format as { type?: string } | undefined)?.type
        ? json({ error: { message: "response_format is not supported", type: "invalid_request_error" } }, 400)
        : streamed(JSON.stringify({ skill: "listening", observation: "o", suggestion: "s", example: "e" })),
    );
    await Promise.all([ai.coachHint(turnRequest()), ai.coachHint(turnRequest()), ai.coachHint(turnRequest())]);
    expect(ai.jsonMode).toBe("text");
    expect(logs.filter((l) => l.includes("falling back"))).toHaveLength(2);
    expect(calls.filter((c) => !c.body.response_format)).toHaveLength(3);
  });

  it("reports truncated replies and maps rate limits", async () => {
    const cut = setup(() => streamed('{"skill":"empathy","observ', "length"));
    expect(((await cut.ai.coachHint(turnRequest()).catch((e: unknown) => e)) as HttpError).code).toBe("ai_output");
    const busy = setup(() => json({ error: { message: "slow down" } }, 429));
    const error = (await busy.ai.createPersona({ request: { context, npc, player } }).catch((e: unknown) => e)) as HttpError;
    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(429);
  });
});

describe("structured-output helpers", () => {
  it("builds a strict schema without integer-range noise", () => {
    const schema = strictJsonSchema(NpcTurnDraftSchema) as { $schema?: string; properties: { rapport_delta: Record<string, unknown>; phrase: { anyOf: { additionalProperties?: boolean }[] } } };
    expect(schema.$schema).toBeUndefined();
    expect(schema.properties.rapport_delta).not.toHaveProperty("minimum");
    expect(schema.properties.phrase.anyOf[0]!.additionalProperties).toBe(false);
  });

  it("coerces replies to the schema", () => {
    expect(coerceToSchema(NpcTurnDraftSchema, { reply: 42, emotion: "ecstatic", phrase: { text: "Jambo" } })).toMatchObject({
      reply: "42",
      gesture: "",
      emotion: "warm",
      rapport_delta: 0,
      perceived_moves: [],
      phrase: { text: "Jambo", meaning: "" },
      conversation_state: "ongoing",
    });
  });

  it("extracts JSON from prose and fences", () => {
    expect(extractJson('Here: {"a": 1} hope that helps')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a": 2}\n```')).toEqual({ a: 2 });
    expect(() => extractJson("no json here")).toThrow(SyntaxError);
  });
});

describe("resolveAi", () => {
  it("maps the generic AI_* variables to the OpenAI-compatible provider", () => {
    expect(resolveAi({ AI_PROVIDER: "openai", AI_MODEL: "qwen3.8-max", AI_BASE_URL: "https://ai.example/v1", AI_API_KEY: "k" })).toEqual({
      aiProvider: "openai",
      model: "qwen3.8-max",
      aiApiKey: "k",
      aiBaseUrl: "https://ai.example/v1",
    });
  });

  it("picks a provider automatically and falls back to Demo AI", () => {
    expect(resolveAi({ ANTHROPIC_API_KEY: "a" })).toMatchObject({ aiProvider: "anthropic", model: "claude-opus-5-5" });
    expect(resolveAi({ OPENAI_API_KEY: "o", OPENAI_MODEL: "gpt-x" })).toMatchObject({ aiProvider: "openai", model: "gpt-x" });
    expect(resolveAi({})).toMatchObject({ aiProvider: "demo" });
    expect(resolveAi({ AI_MODE: "claude" })).toMatchObject({ aiProvider: "anthropic" });
  });

  it("refuses an OpenAI-compatible setup without a model, and unknown providers", () => {
    expect(() => resolveAi({ AI_PROVIDER: "openai" })).toThrow(/AI_MODEL/);
    expect(() => resolveAi({ AI_PROVIDER: "gemini" })).toThrow(/Unknown AI_PROVIDER/);
  });
});
