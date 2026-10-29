// Voice mode and postcards against fake servers: the requests the game sends, and how it copes
// with servers that hear but don't speak, or want audio in another form.
import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { VoiceService, isWav, wavDurationMs, wavFromPcm16, wordOverlap } from "../../server/ai/voice.ts";
import { ImageGateway, postcardPrompt } from "../../server/images.ts";
import { HttpError } from "../../server/util/errors.ts";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const sse = (chunks: Record<string, unknown>[]) =>
  new Response(
    [...chunks.map((delta) => `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 1, model: "omni", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`), "data: [DONE]\n\n"].join(""),
    { headers: { "content-type": "text/event-stream" } },
  );

function voiceSetup(respond: (body: Record<string, unknown>, index: number) => Response) {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    bodies.push(body);
    return respond(body, bodies.length - 1);
  };
  const client = new OpenAI({ apiKey: "k", baseURL: "https://omni.test/v1", fetch: fetchImpl as typeof fetch, maxRetries: 0 });
  const logs: string[] = [];
  return { voice: new VoiceService({ client, model: "qwen3.8-omni-flash", voices: ["Cherry", "Ethan"], log: (m) => logs.push(m) }), bodies, logs };
}

/** One second of a 440 Hz tone at 16 kHz, as the browser's recorder would send. */
const tone = wavFromPcm16(Buffer.from(Int16Array.from({ length: 16_000 }, (_, i) => Math.round(Math.sin((i / 16_000) * 2 * Math.PI * 440) * 8000)).buffer), 16_000);

describe("VoiceService", () => {
  it("reads a line aloud and wraps the streamed PCM as WAV", async () => {
    const pcm = Buffer.alloc(48_000, 1);
    const { voice, bodies } = voiceSetup(() => sse([{ audio: { data: pcm.subarray(0, 24_000).toString("base64"), transcript: "Hello " } }, { audio: { data: pcm.subarray(24_000).toString("base64"), transcript: "there" } }]));
    const result = await voice.speak("Hello there", "Cherry");
    expect(isWav(result.wav)).toBe(true);
    expect(result.durationMs).toBe(1000);
    expect(result.transcript).toBe("Hello there");
    expect(bodies[0]).toMatchObject({ model: "qwen3.8-omni-flash", stream: true, modalities: ["text", "audio"], audio: { voice: "Cherry", format: "wav" } });
    // Cached: replaying a line costs nothing.
    await voice.speak("Hello there", "Cherry");
    expect(bodies).toHaveLength(1);
  });

  it("remembers a model that hears but can't speak, and stops asking", async () => {
    const { voice, bodies } = voiceSetup(() => json({ error: { message: "<400> InvalidParameter: The current model does not support the modalities parameter containing audio." } }, 400));
    const first = (await voice.speak("Hi", "Cherry").catch((e: unknown) => e)) as HttpError;
    expect(first.status).toBe(501);
    expect(first.code).toBe("voice_cannot_speak");
    expect(voice.canSpeak).toBe(false);
    await voice.speak("Again", "Cherry").catch(() => undefined);
    expect(bodies).toHaveLength(1);
  });

  it("hears a recording, sending it as a data URI first and plain base64 if refused", async () => {
    const heard = { transcript: "What do you enjoy most?", tone: "Warm", pace: "natural", clarity: 88, note: "Relaxed and friendly." };
    const { voice, bodies } = voiceSetup((body) => {
      const audio = ((body.messages as { content: unknown }[])[1]!.content as { type: string; input_audio?: { data: string } }[])[0]!.input_audio!.data;
      return audio.startsWith("data:") ? json({ error: { message: "invalid input_audio" } }, 400) : sse([{ content: JSON.stringify(heard) }]);
    });
    const result = await voice.listen(tone, "Talking with Aoki at a konbini.");
    expect(result).toEqual({ ...heard, tone: "warm" });
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toMatchObject({ modalities: ["text"] });
    const content = (bodies[1]!.messages as { content: { type: string; text?: string }[] }[])[1]!.content;
    expect(content[1]).toEqual({ type: "text", text: "Talking with Aoki at a konbini." });
  });

  it("scores a pronunciation attempt against its target phrase", async () => {
    const { voice, bodies } = voiceSetup(() => sse([{ content: '```json\n{"transcript": "konbanwa", "score": 84, "tip": "Lovely — keep the n soft."}\n```' }]));
    expect(await voice.pronounce(tone, { phrase: "Konbanwa", language: "Japanese", meaning: "Good evening" })).toEqual({ transcript: "konbanwa", score: 84, tip: "Lovely — keep the n soft." });
    expect(JSON.stringify(bodies[0])).toContain("Target phrase (Japanese): Konbanwa");
  });

  it("chooses a stable voice per local", () => {
    const { voice } = voiceSetup(() => json({}));
    expect(voice.voiceFor("she/her", "x")).toBe("Cherry");
    expect(voice.voiceFor("he/him", "x")).toBe("Ethan");
    expect(voice.voiceFor("they/them", "exp:npc-2")).toBe(voice.voiceFor("they/them", "exp:npc-2"));
  });

  it("measures WAV and word overlap", () => {
    expect(wavDurationMs(tone)).toBe(1000);
    expect(wordOverlap("Hello! It's my first time here.", "hello it's my first time here")).toBe(1);
    expect(wordOverlap("Hello there", "Goodbye")).toBe(0);
  });
});

describe("ImageGateway", () => {
  const config = { gatewayUrl: "http://gateway.test", apiKey: "gw-key", model: "doubao-seedream-5.0-pro", width: 1536, height: 1024 };

  function gatewaySetup(task: (poll: number) => Record<string, unknown>, files: Record<string, Response> = {}) {
    const calls: { url: string; method: string; body?: unknown; headers: Headers }[] = [];
    let polls = 0;
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: new Headers(init?.headers) });
      if (files[url]) return files[url]!;
      if (init?.method === "POST") return json({ id: "img_1", status: "pending", outputs: [] }, 202);
      return json(task(++polls));
    };
    return { gateway: new ImageGateway({ config, fetchImpl: fetchImpl as typeof fetch, pollMs: 1, log: () => {} }), calls };
  }

  it("creates a task, polls it and downloads the image", async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const { gateway, calls } = gatewaySetup(
      (poll) => (poll < 2 ? { id: "img_1", status: "running" } : { id: "img_1", status: "succeeded", model: "doubao-seedream-5.0-pro", outputs: [{ uri: "https://cdn.test/p.jpeg", mime_type: "image/jpeg" }] }),
      { "https://cdn.test/p.jpeg": new Response(jpeg, { headers: { "content-type": "image/jpeg" } }) },
    );
    const image = await gateway.render("A postcard of Kyoto");
    expect(image.bytes).toEqual(jpeg);
    expect(image.mimeType).toBe("image/jpeg");
    expect(calls[0]).toMatchObject({ url: "http://gateway.test/v1/images", method: "POST", body: { input: [{ type: "text", text: "A postcard of Kyoto" }], model: "doubao-seedream-5.0-pro", parameters: { dimensions: { width: 1536, height: 1024 }, watermark: false } } });
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer gw-key");
    expect(calls[0]!.headers.get("idempotency-key")).toMatch(/^life-/);
    expect(calls.filter((c) => c.url.endsWith("/v1/images/img_1"))).toHaveLength(2);
  });

  it("decodes inline images and asks once more when the provider refuses its own output", async () => {
    let created = 0;
    const fetchImpl = async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") return json({ id: `img_${++created}`, status: "pending" }, 202);
      return created === 1
        ? json({ id: "img_1", status: "failed", error: { code: "generation_failed", message: "400 OutputImageSensitiveContentDetected" } })
        : json({ id: "img_2", status: "succeeded", outputs: [{ uri: `data:image/png;base64,${Buffer.from("png!").toString("base64")}` }] });
    };
    const gateway = new ImageGateway({ config, fetchImpl: fetchImpl as typeof fetch, pollMs: 1, log: () => {} });
    const image = await gateway.render("A postcard");
    expect(created).toBe(2);
    expect(image).toMatchObject({ mimeType: "image/png" });
    expect(image.bytes.toString()).toBe("png!");
  });

  it("maps gateway errors to player-safe messages", async () => {
    const busy = new ImageGateway({ config, fetchImpl: (async () => json({ detail: "busy" }, 429)) as typeof fetch, log: () => {} });
    expect(((await busy.render("x").catch((e: unknown) => e)) as HttpError).status).toBe(429);
    const failed = new ImageGateway({ config, fetchImpl: (async (_i: unknown, init?: RequestInit) => (init?.method === "POST" ? json({ id: "a", status: "pending" }, 202) : json({ id: "a", status: "failed", error: { code: "generation_failed", message: "401" } }))) as typeof fetch, pollMs: 1, log: () => {} });
    expect(((await failed.render("x").catch((e: unknown) => e)) as HttpError).code).toBe("images_failed");
  });

  it("paints only the place and the themes explored", () => {
    const prompt = postcardPrompt({ expeditionId: "e", label: "Kyoto", country: "Japan", lenses: ["culture", "economy", "culture"] });
    expect(prompt).toContain("Kyoto, Japan");
    expect(prompt).toContain("architecture, crafts and traditions; its markets, workshops and small trades");
    expect(prompt).toContain("No text");
  });
});
