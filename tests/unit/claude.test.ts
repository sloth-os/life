// Exercises ClaudeGameAI through the real Anthropic SDK with a fake fetch:
// verifies the request we send and our handling of streamed responses.
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { ClaudeGameAI } from "../../server/ai/claude.ts";
import type { NpcTurnDraft } from "../../server/ai/schemas.ts";
import type { AiTask, Effort } from "../../server/config.ts";
import { HttpError } from "../../server/util/errors.ts";
import { context, npc, pack, player, turnRequest } from "./fixtures.ts";

interface Call {
  url: string;
  body: Record<string, unknown>;
  headers: Headers;
}

function sse(events: Record<string, unknown>[]): Response {
  const body = events.map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** A realistic streamed message: an (omitted) thinking block, then the JSON text in chunks. */
function streamedMessage(text: string, stopReason = "end_turn", extraDelta: Record<string, unknown> = {}): Response {
  const chunks = text.match(/.{1,7}/gs) ?? [];
  return sse([
    {
      type: "message_start",
      message: { id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 } },
    },
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
    ...chunks.map((chunk) => ({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: chunk } })),
    { type: "content_block_stop", index: 1 },
    { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null, ...extraDelta }, usage: { output_tokens: 180 } },
    { type: "message_stop" },
  ]);
}

const effort: Record<AiTask, Effort> = { expedition: "medium", persona: "medium", turn: "low", hint: "low", debrief: "medium" };

function setup(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>, headers: new Headers(init?.headers) };
    calls.push(call);
    return respond(call);
  };
  const client = new Anthropic({ apiKey: "sk-test", fetch: fetchImpl as typeof fetch, maxRetries: 0 });
  const logs: string[] = [];
  return { ai: new ClaudeGameAI({ client, model: "claude-opus-5-5", effort, log: (m) => logs.push(m) }), calls, logs };
}

const turnDraft: NpcTurnDraft = {
  reply: "Mangoes, mostly — and gossip. What brings you to Moi Avenue?",
  gesture: "laughs",
  emotion: "warm",
  rapport_delta: 7,
  perceived_moves: ["greeting", "open_question"],
  inner_thought: "A real question, not a sales pitch.",
  revealed_insight_ids: [],
  phrase: { text: "Karibu", meaning: "Welcome" },
  conversation_state: "ongoing",
};

describe("ClaudeGameAI", () => {
  it("sends a cached, structured, fallback-enabled request and streams the reply", async () => {
    const { ai, calls, logs } = setup(() => streamedMessage(JSON.stringify(turnDraft)));
    const snapshots: string[] = [];
    const draft = await ai.npcTurn({ request: turnRequest(), turnNumber: 1, wrapUp: false }, (s) => snapshots.push(s));

    expect(draft).toEqual(turnDraft);
    expect(snapshots.length).toBeGreaterThan(3);
    expect(snapshots.at(-1)).toBe(turnDraft.reply);
    for (let i = 1; i < snapshots.length; i++) expect(snapshots[i]!.startsWith(snapshots[i - 1]!)).toBe(true);

    const [call] = calls;
    expect(call!.url).toContain("/v1/messages");
    const betas = call!.headers.get("anthropic-beta") ?? "";
    expect(betas).toContain("server-side-fallback-2026-07-01");
    expect(betas).toContain("structured-outputs-2025-12-15");
    const body = call!.body;
    expect(body).toMatchObject({ model: "claude-opus-5-5", stream: true, fallbacks: "default", max_tokens: 8000, cache_control: { type: "ephemeral" } });
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("thinking");
    const output = body.output_config as { effort: string; format: { type: string; schema: { properties: Record<string, unknown>; additionalProperties: boolean } } };
    expect(output.effort).toBe("low");
    expect(output.format.type).toBe("json_schema");
    expect(Object.keys(output.format.schema.properties)[0]).toBe("reply");
    expect(output.format.schema.additionalProperties).toBe(false);
    const system = body.system as { text: string; cache_control?: unknown }[];
    expect(system).toHaveLength(2);
    expect(system.every((b) => b.cache_control)).toBe(true);
    expect(system[0]!.text).toContain("Rapport is earned");
    expect(system[1]!.text).toContain("You are Wanjiru");
    const messages = body.messages as { role: string }[];
    expect(messages[0]!.role).toBe("user");
    expect(messages.at(-1)!.role).toBe("user");
    expect(logs[0]).toMatch(/turn claude-opus-5-5 .* cache_read=900/);
  });

  it("uses medium effort and a single cached system block for the Game Master", async () => {
    const draft = {
      title: "Rain on Moi Avenue",
      scene: "s",
      locality: { city: "Nairobi", region: "", country: "Kenya" },
      greeting: { language: "Swahili", phrase: "Habari", meaning: "What news?", pronunciation: "ha-BAH-ree" },
      curiosity: ["a", "b", "c"],
      notes: "n",
      npcs: [],
    };
    const { ai, calls } = setup(() => streamedMessage(JSON.stringify(draft)));
    await expect(ai.composeExpedition({ destination: { lat: 0, lng: 0, label: "Nairobi", source: "postcard" }, pack, player, suggestedDifficulty: 1 })).resolves.toEqual(draft);
    const body = calls[0]!.body;
    expect((body.output_config as { effort: string }).effort).toBe("medium");
    expect((body.system as unknown[]).length).toBe(1);
    expect(JSON.stringify(body.messages)).toContain("[W1] Moi Avenue (Nairobi)");
  });

  it("turns a refusal into a player-safe error", async () => {
    const { ai } = setup(() => streamedMessage("", "refusal", { stop_details: { type: "refusal", category: null, explanation: "declined" } }));
    const error = await ai.coachHint({ ...turnRequest() }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).code).toBe("ai_refusal");
  });

  it("rejects output that doesn't match the schema", async () => {
    const { ai } = setup(() => streamedMessage('{"skill":"juggling"}'));
    const error = await ai.coachHint({ ...turnRequest() }).catch((e: unknown) => e);
    expect((error as HttpError).code).toBe("ai_output");
  });

  it("reports truncated output", async () => {
    const { ai } = setup(() => streamedMessage('{"reply":"cut', "max_tokens"));
    const error = await ai.npcTurn({ request: turnRequest(), turnNumber: 1, wrapUp: false }).catch((e: unknown) => e);
    expect((error as HttpError).code).toBe("ai_output");
  });

  it("maps rate limits to a friendly 429", async () => {
    const { ai } = setup(
      () => new Response(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "slow down" } }), { status: 429, headers: { "content-type": "application/json" } }),
    );
    const error = await ai.createPersona({ request: { context, npc, player } }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(429);
    expect((error as HttpError).code).toBe("ai_busy");
  });
});
