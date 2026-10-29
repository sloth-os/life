// Ask the configured OpenAI-compatible model for a tiny JSON reply in each structured-output
// mode, and report reachability, latency and what the server accepts. CI runs it before the
// real-services suite, so a misconfigured model fails fast with a clear reason.
//   node scripts/probe-ai.ts
import OpenAI from "openai";
import { loadConfig, loadDotEnv } from "../server/config.ts";

loadDotEnv();
const config = loadConfig();
if (config.aiProvider !== "openai") {
  console.log(`probe: the AI provider is ${config.aiProvider}; nothing to probe.`);
  process.exit(0);
}

const client = new OpenAI({ apiKey: config.aiApiKey ?? "not-needed", baseURL: config.aiBaseUrl, maxRetries: 0, timeout: 120_000 });
const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };
const formats: [string, OpenAI.ChatCompletionCreateParams["response_format"]][] = [
  ["json_schema", { type: "json_schema", json_schema: { name: "probe", schema, strict: true } }],
  ["json_object", { type: "json_object" }],
  ["text", undefined],
];

console.log(`probe: ${config.model} at ${config.aiBaseUrl ?? "the default OpenAI endpoint"}`);
let answered = false;
for (const [mode, format] of formats) {
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
    });
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
    console.log(`probe ${mode}: ok in ${Date.now() - started}ms (first token ${firstToken}ms, ${reasoning} reasoning chars): ${JSON.stringify(text.slice(0, 120))}`);
  } catch (error) {
    const detail = error instanceof OpenAI.APIError ? `${error.status ?? "no status"} ${error.message}` : String(error);
    console.log(`probe ${mode}: failed after ${Date.now() - started}ms: ${detail.slice(0, 300)}`);
  }
}

if (!answered) {
  console.error("probe: the model did not answer in any mode.");
  process.exit(1);
}
