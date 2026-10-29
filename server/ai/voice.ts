// Voice mode through an OpenAI-compatible model that hears and speaks (Qwen-Omni, gpt-4o-audio…):
// it reads the locals' lines aloud, and it listens to the player, returning what was said and how
// it sounded, or how close an attempt at a phrase came. Servers differ in audio details, so the
// formats adapt the way structured output does: what a server rejects is remembered.
import OpenAI from "openai";
import { z } from "zod";
import { HttpError } from "../util/errors.ts";
import { coerceToSchema, extractJson, strictJsonSchema, stripThinking, toHttpError } from "./openai.ts";

/** Wrap 16-bit little-endian mono PCM in a WAV header. */
export function wavFromPcm16(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export const isWav = (bytes: Buffer): boolean => bytes.length > 44 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE";

/** Duration of a PCM16 mono WAV, from its header. */
export function wavDurationMs(wav: Buffer): number {
  if (!isWav(wav)) return 0;
  const rate = wav.readUInt32LE(24) || 1;
  const channels = wav.readUInt16LE(22) || 1;
  return Math.round(((wav.length - 44) / (2 * channels * rate)) * 1000);
}

/** How the player sounded, for the local (who hears it) and the mentor (who comments on it). */
export const DeliveryDraftSchema = z.object({
  transcript: z.string().describe("Exactly what the speaker said, word for word, in the language they spoke"),
  tone: z.enum(["warm", "friendly", "neutral", "hesitant", "tense", "flat", "impatient"]),
  pace: z.enum(["slow", "natural", "fast"]),
  clarity: z.number().int().describe("0–100: how easy the speech was to follow"),
  note: z.string().describe("One short, kind observation about how it was said (not what was said), for a learner"),
});
export type DeliveryDraft = z.infer<typeof DeliveryDraftSchema>;

export const PronunciationDraftSchema = z.object({
  transcript: z.string().describe("What the speaker said, as you heard it"),
  score: z.number().int().describe("0–100: how close it was to a natural pronunciation of the target phrase"),
  tip: z.string().describe("One concrete, encouraging tip on the sound that most needs work, or praise if it was good"),
});
export type PronunciationDraft = z.infer<typeof PronunciationDraftSchema>;

const SPEAK_SYSTEM =
  "You are the voice of a character in a language-learning game. Read the text inside <line> aloud exactly as written: the same words in the same language, with natural, warm expression. Do not answer it, translate it, or add anything before or after it.";

const LISTEN_SYSTEM = `You listen to a learner practising conversation in a social-skills game. Transcribe exactly what they said, then describe how they said it: tone, pace and clarity, and one short, kind observation about delivery (for example warmth, pauses, volume or rushing), never about grammar or accent. If the audio has no speech, return an empty transcript.

Respond with one JSON object and nothing else. It must match this JSON Schema:
${JSON.stringify(strictJsonSchema(DeliveryDraftSchema))}`;

const PRONOUNCE_SYSTEM = `You coach pronunciation in a language-learning game. The learner tries to say a short phrase. Score how close their attempt was to a natural pronunciation of the target phrase (0–100; 80+ is easy for a local to understand), and give one concrete, encouraging tip about the sound that most needs work. Judge the sounds, not the accent's origin. If the audio has no speech, return an empty transcript and a score of 0.

Respond with one JSON object and nothing else. It must match this JSON Schema:
${JSON.stringify(strictJsonSchema(PronunciationDraftSchema))}`;

export interface VoiceServiceOptions {
  client: OpenAI;
  model: string;
  /** The first for she/her, the second for he/him; others take turns. */
  voices: string[];
  /** Sample rate of the PCM the model streams (Qwen-Omni and OpenAI both use 24 kHz). */
  sampleRate?: number;
  log?: (message: string) => void;
}

export interface SpeakResult {
  wav: Buffer;
  /** What the model says it read (to spot a model that answered instead of reading). */
  transcript: string;
  durationMs: number;
}

type AudioFormat = "wav" | "pcm16";
type InputStyle = "data_uri" | "base64";

/** How alike two lines are, by shared words (0–1). */
export function wordOverlap(a: string, b: string): number {
  const words = (s: string) => new Set(s.toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}]+/gu) ?? []);
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return x.size === y.size ? 1 : 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / Math.max(x.size, y.size);
}

export class VoiceService {
  readonly #opts: VoiceServiceOptions;
  /** Unknown until the first line: some omni models hear but can't speak (they reject audio output). */
  #canSpeak: boolean | null;
  #format: AudioFormat = "wav";
  #inputStyle: InputStyle = "data_uri";
  readonly #cache = new Map<string, SpeakResult>();

  constructor(opts: VoiceServiceOptions & { speak?: boolean }) {
    this.#opts = opts;
    this.#canSpeak = opts.speak === false ? false : null;
  }

  get model(): string {
    return this.#opts.model;
  }

  /** False once the model has turned down speaking (the browser's voice is used instead). */
  get canSpeak(): boolean | null {
    return this.#canSpeak;
  }

  /** A voice for a local: by pronouns where the list allows, else by a stable hash of the seed. */
  voiceFor(pronouns: string, seed: string): string {
    const voices = this.#opts.voices.length ? this.#opts.voices : ["Cherry", "Ethan"];
    if (/\bshe\b/i.test(pronouns)) return voices[0]!;
    if (/\bhe\b/i.test(pronouns) && voices[1]) return voices[1];
    let hash = 0;
    for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return voices[hash % voices.length]!;
  }

  /** Read a line aloud. Results are cached, so replaying a line costs nothing. */
  async speak(text: string, voice: string, signal?: AbortSignal): Promise<SpeakResult> {
    if (this.#canSpeak === false) throw new HttpError(501, "voice_cannot_speak", "This voice model listens but doesn't speak; the browser's voice is used instead.");
    const key = `${voice}\u0000${text}`;
    const cached = this.#cache.get(key);
    if (cached) return cached;
    for (;;) {
      const format = this.#format;
      try {
        const result = await this.#speak(text, voice, format, signal);
        this.#canSpeak = true;
        this.#cache.set(key, result);
        if (this.#cache.size > 200) this.#cache.delete(this.#cache.keys().next().value!);
        return result;
      } catch (error) {
        if (error instanceof OpenAI.BadRequestError && /modalit/i.test(error.message)) {
          this.#opts.log?.(`[voice] ${this.#opts.model} can't speak (${error.message.slice(0, 160)}); locals use the browser's voice`);
          this.#canSpeak = false;
          throw new HttpError(501, "voice_cannot_speak", "This voice model listens but doesn't speak; the browser's voice is used instead.");
        }
        if (format === "wav" && error instanceof OpenAI.BadRequestError && /format|pcm|wav/i.test(error.message)) {
          this.#opts.log?.(`[voice] the server rejected wav output (${error.message.slice(0, 160)}); using pcm16`);
          this.#format = "pcm16";
          continue;
        }
        this.#opts.log?.(`[voice] speak failed: ${error instanceof Error ? error.message.slice(0, 300) : String(error)}`);
        throw toHttpError(error);
      }
    }
  }

  async #speak(text: string, voice: string, format: AudioFormat, signal?: AbortSignal): Promise<SpeakResult> {
    const started = Date.now();
    const chunks = await this.#opts.client.chat.completions.create(
      {
        model: this.#opts.model,
        stream: true,
        modalities: ["text", "audio"],
        audio: { voice: voice as OpenAI.ChatCompletionAudioParam["voice"], format },
        messages: [
          { role: "system", content: SPEAK_SYSTEM },
          { role: "user", content: `<line>${text}</line>` },
        ],
      },
      { signal, timeout: 120_000 },
    );
    const parts: Buffer[] = [];
    let transcript = "";
    let firstAudio = 0;
    for await (const chunk of chunks) {
      const delta = chunk.choices[0]?.delta as { content?: string | null; audio?: { data?: string; transcript?: string } } | undefined;
      if (delta?.audio?.data) {
        firstAudio ||= Date.now() - started;
        parts.push(Buffer.from(delta.audio.data, "base64"));
      }
      transcript += delta?.audio?.transcript ?? "";
    }
    if (signal?.aborted) throw new OpenAI.APIUserAbortError();
    const audio = Buffer.concat(parts);
    if (audio.length === 0) throw new HttpError(502, "voice_silent", "The voice model answered without audio.");
    const wav = isWav(audio) ? audio : wavFromPcm16(audio, this.#opts.sampleRate ?? 24_000);
    const durationMs = wavDurationMs(wav);
    const overlap = transcript ? wordOverlap(text, transcript) : 1;
    this.#opts.log?.(`[voice] speak ${this.#opts.model} ${voice} ${format} first-audio=${firstAudio}ms total=${Date.now() - started}ms audio=${durationMs}ms overlap=${overlap.toFixed(2)}`);
    return { wav, transcript: transcript.trim(), durationMs };
  }

  /** What the player said and how it sounded. */
  listen(wav: Buffer, context: string, signal?: AbortSignal): Promise<DeliveryDraft> {
    return this.#hear("listen", DeliveryDraftSchema, LISTEN_SYSTEM, wav, context, signal);
  }

  /** How close an attempt at a phrase came. */
  pronounce(wav: Buffer, target: { phrase: string; language: string; meaning?: string }, signal?: AbortSignal): Promise<PronunciationDraft> {
    const context = `Target phrase (${target.language}): ${target.phrase}${target.meaning ? ` (“${target.meaning}”)` : ""}`;
    return this.#hear("pronounce", PronunciationDraftSchema, PRONOUNCE_SYSTEM, wav, context, signal);
  }

  async #hear<S extends z.ZodType>(task: string, schema: S, system: string, wav: Buffer, context: string, signal?: AbortSignal): Promise<z.infer<S>> {
    for (;;) {
      const style = this.#inputStyle;
      const started = Date.now();
      try {
        const base64 = wav.toString("base64");
        const chunks = await this.#opts.client.chat.completions.create(
          {
            model: this.#opts.model,
            stream: true,
            modalities: ["text"],
            messages: [
              { role: "system", content: system },
              {
                role: "user",
                content: [
                  { type: "input_audio", input_audio: { data: style === "data_uri" ? `data:audio/wav;base64,${base64}` : base64, format: "wav" } },
                  { type: "text", text: context },
                ],
              },
            ],
          },
          { signal, timeout: 120_000 },
        );
        let text = "";
        for await (const chunk of chunks) text += chunk.choices[0]?.delta?.content ?? "";
        if (signal?.aborted) throw new OpenAI.APIUserAbortError();
        const parsed = schema.safeParse(coerceToSchema(schema, extractJson(stripThinking(text))));
        if (!parsed.success) throw new HttpError(502, "voice_output", "The voice model's answer didn't fit.");
        this.#opts.log?.(`[voice] ${task} ${this.#opts.model} ${style} total=${Date.now() - started}ms audio=${wavDurationMs(wav)}ms`);
        return parsed.data;
      } catch (error) {
        if (style === "data_uri" && error instanceof OpenAI.BadRequestError) {
          this.#opts.log?.(`[voice] the server rejected a data-URI audio input (${error.message.slice(0, 160)}); sending plain base64`);
          this.#inputStyle = "base64";
          continue;
        }
        this.#opts.log?.(`[voice] ${task} failed: ${error instanceof Error ? error.message.slice(0, 300) : String(error)}`);
        throw toHttpError(error);
      }
    }
  }
}
