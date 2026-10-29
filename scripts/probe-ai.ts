// Probe the configured AI services with tiny requests and report what each server accepts and how
// fast it answers: the text model in each structured-output mode (with the thinking switch the game
// sends), the voice model speaking and listening, and the image gateway. CI runs it before the
// real-services suite, so a misconfigured service fails fast with the server's own answer.
//   node scripts/probe-ai.ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import OpenAI from "openai";
import { detectThinkingStyle, loadConfig, loadDotEnv } from "../server/config.ts";
import { thinkingFields } from "../server/ai/openai.ts";
import { VoiceService, wavDurationMs, wordOverlap } from "../server/ai/voice.ts";
import { ImageGateway } from "../server/images.ts";

loadDotEnv();
const config = loadConfig();
const OUT = "test-results/probe";
await mkdir(OUT, { recursive: true });
let failures = 0;

const describe = (error: unknown) => (error instanceof OpenAI.APIError ? `${error.status ?? "no status"} ${error.message}` : error instanceof Error ? error.message : String(error)).slice(0, 300);

async function probeText(): Promise<void> {
  if (config.aiProvider !== "openai") {
    console.log(`text: the AI provider is ${config.aiProvider}; nothing to probe.`);
    return;
  }
  const client = new OpenAI({ apiKey: config.aiApiKey ?? "not-needed", baseURL: config.aiBaseUrl, maxRetries: 0, timeout: 120_000 });
  const style = config.thinkingStyle === "auto" ? detectThinkingStyle(config.model) : config.thinkingStyle;
  const thinking = thinkingFields(style, config.thinking, "low");
  const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };
  const formats: [string, OpenAI.ChatCompletionCreateParams["response_format"]][] = [
    ["json_schema", { type: "json_schema", json_schema: { name: "probe", schema, strict: true } }],
    ["json_object", { type: "json_object" }],
    ["text", undefined],
  ];
  console.log(`text: ${config.model} at ${config.aiBaseUrl ?? "the default OpenAI endpoint"} (thinking switch: ${JSON.stringify(thinking)})`);
  let answered = false;
  for (const [mode, format] of formats) {
    for (const extra of Object.keys(thinking).length ? [thinking, {}] : [{}]) {
      const started = Date.now();
      try {
        const stream = await client.chat.completions.create({
          model: config.model,
          stream: true,
          messages: [
            { role: "system", content: 'Reply with the JSON object {"ok": true} and nothing else.' },
            { role: "user", content: "Probe." },
          ],
          ...(format ? { response_format: format } : {}),
          ...(extra as object),
        } as OpenAI.ChatCompletionCreateParamsStreaming);
        let text = "";
        let reasoning = 0;
        let firstToken = 0;
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta as { content?: string | null; reasoning_content?: string | null } | undefined;
          reasoning += delta?.reasoning_content?.length ?? 0;
          if (delta?.content) {
            firstToken ||= Date.now() - started;
            text += delta.content;
          }
        }
        answered = true;
        console.log(`text ${mode} ${JSON.stringify(extra)}: ok in ${Date.now() - started}ms (first token ${firstToken}ms, ${reasoning} reasoning chars): ${JSON.stringify(text.slice(0, 120))}`);
      } catch (error) {
        console.log(`text ${mode} ${JSON.stringify(extra)}: failed after ${Date.now() - started}ms: ${describe(error)}`);
      }
    }
  }
  if (!answered) {
    console.error("text: the model did not answer in any mode.");
    failures++;
  }
}

/** Speech clips CI synthesizes with espeak-ng (see the workflow); the probe skips what's missing. */
const SPEECH = { line: "test-results/real/voice-input.wav", phrase: "test-results/real/pronounce-es.wav" };
const SPOKEN_LINE = "Hello! It's my first time here. What do you enjoy most about your work?";

async function probeVoice(): Promise<void> {
  const voice = config.voice;
  if (!voice) {
    console.log("voice: not configured (VOICE_MODEL).");
    return;
  }
  const client = new OpenAI({ apiKey: voice.apiKey ?? "not-needed", baseURL: voice.baseUrl, maxRetries: 0, timeout: 120_000 });
  const service = new VoiceService({ client, model: voice.model, voices: voice.voices, log: (m) => console.log(m) });
  console.log(`voice: ${voice.model} at ${voice.baseUrl ?? "the default OpenAI endpoint"}, voices ${voice.voices.join(", ")}`);
  // Speaking is optional: a model that only hears leaves the locals' voices to the browser.
  try {
    const spoken = await service.speak(SPOKEN_LINE, voice.voices[0]!);
    await writeFile(`${OUT}/speak.wav`, spoken.wav);
    console.log(`voice speak: ${spoken.durationMs}ms of audio, transcript ${JSON.stringify(spoken.transcript)} (word overlap ${wordOverlap(SPOKEN_LINE, spoken.transcript).toFixed(2)})`);
  } catch (error) {
    console.log(`voice speak: unavailable (${describe(error)}); the locals use the browser's voice.`);
  }
  const line = await readFile(SPEECH.line).catch(() => null);
  if (line) {
    try {
      const heard = await service.listen(line, "The learner is greeting a local.");
      console.log(`voice listen: ${wavDurationMs(line)}ms → ${JSON.stringify(heard)} (word overlap ${wordOverlap(SPOKEN_LINE, heard.transcript).toFixed(2)})`);
    } catch (error) {
      console.log(`voice listen failed: ${describe(error)}`);
      failures++;
    }
  } else console.log(`voice listen: skipped (no ${SPEECH.line})`);
  const phrase = await readFile(SPEECH.phrase).catch(() => null);
  if (phrase) {
    try {
      const scored = await service.pronounce(phrase, { phrase: "Buenas noches", language: "Spanish", meaning: "Good evening" });
      console.log(`voice pronounce: ${wavDurationMs(phrase)}ms → ${JSON.stringify(scored)}`);
    } catch (error) {
      console.log(`voice pronounce failed: ${describe(error)}`);
      failures++;
    }
  } else console.log(`voice pronounce: skipped (no ${SPEECH.phrase})`);
}

async function probeImages(): Promise<void> {
  if (!config.images) {
    console.log("images: not configured (MM_GATEWAY_URL, MM_GATEWAY_API_KEY).");
    return;
  }
  const gateway = new ImageGateway({ config: config.images, log: (m) => console.log(m) });
  console.log(`images: ${config.images.model ?? "auto"} through ${config.images.gatewayUrl} at ${config.images.width}x${config.images.height}`);
  try {
    const image = await gateway.render("A hand-painted travel postcard of Kyoto, Japan at dusk: lantern-lit wooden machiya houses along a quiet lane, soft watercolour, no text, no people.");
    const ext = image.mimeType.split("/")[1] ?? "img";
    await writeFile(`${OUT}/postcard.${ext}`, image.bytes);
    console.log(`images: ${image.model} painted ${Math.round(image.bytes.length / 1024)}KB ${image.mimeType} in ${image.ms}ms`);
  } catch (error) {
    console.log(`images failed: ${describe(error)}`);
    failures++;
  }
}

await probeText();
await probeVoice();
await probeImages();
if (failures) {
  console.error(`probe: ${failures} service(s) failed.`);
  process.exit(1);
}
