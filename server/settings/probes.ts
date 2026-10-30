// The settings page's "Test" buttons: a small, cheap request to each service with the settings
// as they stand in the form, before they are saved. Nothing here paints a postcard or writes an
// expedition: a few tokens of text, a second of silence to hear, a word to speak, a tool list.
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { ProbeResult, ProbeTarget } from "../../shared/settings.ts";
import { thinkingFields, tokenFieldFor } from "../ai/openai.ts";
import { VoiceService, wavFromPcm16 } from "../ai/voice.ts";
import { detectThinkingStyle, type ServerConfig } from "../config.ts";
import { MapsAgentTools } from "../grounding/mapsAgentTools.ts";
import { ImageGateway } from "../images.ts";
import { HttpError } from "../util/errors.ts";

const TIMEOUT_MS = 45_000;

function describe(error: unknown): string {
  if (error instanceof OpenAI.APIError || error instanceof Anthropic.APIError) return `${error.status ?? "no answer"}: ${error.message}`.slice(0, 300);
  if (error instanceof HttpError) return error.message;
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

async function timed(work: (signal: AbortSignal) => Promise<string>): Promise<ProbeResult> {
  const started = Date.now();
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  try {
    const message = await work(signal);
    return { ok: true, ms: Date.now() - started, message };
  } catch (error) {
    const message = signal.aborted ? `No answer within ${TIMEOUT_MS / 1000} s.` : describe(error);
    return { ok: false, ms: Date.now() - started, message };
  }
}

const host = (url: string | undefined, fallback: string) => {
  try {
    return url ? new URL(url).host : fallback;
  } catch {
    return url ?? fallback;
  }
};

async function probeAi(config: ServerConfig): Promise<string> {
  if (config.aiProvider === "demo") return "Demo AI is built in: scripted locals, no model to reach.";
  if (config.aiProvider === "anthropic") {
    const client = new Anthropic({ apiKey: config.aiApiKey ?? null, baseURL: config.aiBaseUrl ?? null, maxRetries: 0 });
    const message = await client.messages.create({ model: config.model, max_tokens: 16, messages: [{ role: "user", content: "Reply with the word OK." }] }, { timeout: TIMEOUT_MS });
    const text = message.content.find((b) => b.type === "text")?.text.trim() ?? "";
    return `${message.model} at ${host(config.aiBaseUrl, "api.anthropic.com")} answered “${text.slice(0, 40)}”.`;
  }
  const client = new OpenAI({ apiKey: config.aiApiKey ?? "not-needed", baseURL: config.aiBaseUrl ?? null, maxRetries: 0 });
  const style = config.thinkingStyle === "auto" ? detectThinkingStyle(config.model) : config.thinkingStyle;
  const stream = await client.chat.completions.create(
    {
      model: config.model,
      stream: true,
      messages: [{ role: "user", content: "Reply with the word OK." }],
      ...thinkingFields(style, config.thinking, "low"),
      [tokenFieldFor(config.model)]: 64,
    } as OpenAI.ChatCompletionCreateParamsStreaming,
    { timeout: TIMEOUT_MS },
  );
  let text = "";
  let firstToken = 0;
  const started = Date.now();
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? "";
    if (delta) firstToken ||= Date.now() - started;
    text += delta;
  }
  return `${config.model} at ${host(config.aiBaseUrl, "api.openai.com")} answered “${text.trim().slice(0, 40)}” (first words after ${firstToken} ms).`;
}

async function probeVoice(config: ServerConfig, signal: AbortSignal): Promise<string> {
  const voice = config.voice;
  if (!voice) throw new Error("Voice is off: set VOICE_MODEL (to hear players) or VOICE_TTS_MODEL (for the locals' voices).");
  const client = new OpenAI({ apiKey: voice.apiKey ?? "not-needed", baseURL: voice.baseUrl ?? null, maxRetries: 0 });
  const service = new VoiceService({ client, model: voice.model, ttsModel: voice.ttsModel, voices: voice.voices });
  const parts: string[] = [];
  if (voice.model) {
    // A second of quiet: enough to see the model take audio in and answer in the expected shape.
    const quiet = wavFromPcm16(Buffer.alloc(16_000 * 2), 16_000);
    await service.listen(quiet, "A microphone check: there may be no speech.", signal);
    parts.push(`${voice.model} hears audio`);
  }
  try {
    const spoken = await service.speak("Hello!", voice.voices[0] ?? "Cherry", signal);
    parts.push(`${voice.ttsModel ?? voice.model} speaks (${Math.round(spoken.wav.length / 1024)} KB of ${spoken.mimeType})`);
  } catch (error) {
    if (!(error instanceof HttpError && error.code === "voice_cannot_speak")) throw error;
    parts.push(`${voice.model} doesn't speak, so locals use the browser's voices`);
  }
  return `${parts.join("; ")} at ${host(voice.baseUrl, "api.openai.com")}.`;
}

async function probeImages(config: ServerConfig, signal: AbortSignal): Promise<string> {
  if (!config.images) throw new Error("Postcards need MM_GATEWAY_URL and MM_GATEWAY_API_KEY.");
  const models = await new ImageGateway({ config: config.images }).models(signal);
  if (config.images.model && !models.includes(config.images.model)) {
    throw new Error(`The gateway doesn't offer ${config.images.model} to this key. It offers: ${models.join(", ") || "no image models"}.`);
  }
  return `mm-gateway at ${host(config.images.gatewayUrl, "?")} offers ${models.length ? models.join(", ") : "no image models"}.`;
}

async function probeMaps(config: ServerConfig): Promise<string> {
  const parts: string[] = [];
  if (config.mapsMode !== "google") throw new Error("Google Maps is off: set GOOGLE_MAPS_API_KEY (and MAPS_MODE auto or google).");
  parts.push("the browser key is set (the browser checks it when the map loads)");
  if (config.googleMapsServerKey) {
    const tools = new MapsAgentTools({ apiKey: config.googleMapsServerKey, version: config.version });
    try {
      const found = await tools.searchPlaces("museum near Kyoto Station", { lat: 34.9858, lng: 135.7588 }, 2000);
      parts.push(`the agent tools answered search_places with ${found.places.length} places`);
    } finally {
      await tools.close();
    }
  } else parts.push("no GOOGLE_MAPS_SERVER_KEY, so grounding uses Wikipedia");
  return `Google Maps: ${parts.join("; ")}.`;
}

export function probe(target: ProbeTarget, config: ServerConfig): Promise<ProbeResult> {
  switch (target) {
    case "ai":
      return timed(() => probeAi(config));
    case "voice":
      return timed((signal) => probeVoice(config, signal));
    case "images":
      return timed((signal) => probeImages(config, signal));
    case "maps":
      return timed(() => probeMaps(config));
  }
}
