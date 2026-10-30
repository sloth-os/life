// The evaluation pass (docs/DESIGN.md §7.5) against the model the game is configured with:
// Claude, an OpenAI-compatible model, or Demo AI (to check the harness itself). Writes
// test-results/eval/report.json and report.md, and prints the summary.
//   node scripts/eval.ts [--places 4] [--judge] [--offline] [--strict] [--out test-results/eval]
//     --places   how many places the stereotype and grounding audits cover (spread across continents)
//     --judge    also ask the model whether each insight is supported by the sources it cites
//     --offline  canned Wikipedia and weather instead of the live services (the model is still live)
//     --strict   exit with an error when a check fails
import { mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { ServerConfig } from "../server/config.ts";
import { reportMarkdown, runEvaluation } from "../server/eval/index.ts";
import { GroundingService } from "../server/grounding/index.ts";
import { MapsAgentTools } from "../server/grounding/mapsAgentTools.ts";
import { createAI } from "../server/runtime.ts";
import { loadEffectiveConfig } from "../server/settings/load.ts";

const { values: args } = parseArgs({
  options: {
    places: { type: "string", default: "4" },
    judge: { type: "boolean", default: false },
    offline: { type: "boolean", default: false },
    strict: { type: "boolean", default: false },
    out: { type: "string", default: "test-results/eval" },
  },
});

const log = (message: string) => console.log(message);
const config = await loadEffectiveConfig();

const JUDGE_PROMPT = (fact: string, sources: string) =>
  `Sources:\n${sources.slice(0, 6000)}\n\nClaim: ${fact}\n\nIs the claim supported by the sources above (general knowledge doesn't count)? Answer with exactly one word: yes, partly or no.`;

/** A short yes/partly/no from the configured model. */
function judgeFor(config: ServerConfig): ((fact: string, sources: string) => Promise<"yes" | "partly" | "no">) | undefined {
  const verdict = (text: string) => {
    const word = text.trim().toLowerCase().match(/yes|partly|no/)?.[0];
    return (word ?? "no") as "yes" | "partly" | "no";
  };
  if (config.aiProvider === "anthropic") {
    const client = new Anthropic({ apiKey: config.aiApiKey ?? null, baseURL: config.aiBaseUrl ?? null, maxRetries: 2 });
    return async (fact, sources) => {
      const message = await client.messages.create({ model: config.models.debrief, max_tokens: 16, messages: [{ role: "user", content: JUDGE_PROMPT(fact, sources) }] });
      return verdict(message.content.find((b) => b.type === "text")?.text ?? "");
    };
  }
  if (config.aiProvider === "openai") {
    const client = new OpenAI({ apiKey: config.aiApiKey ?? "not-needed", baseURL: config.aiBaseUrl ?? null, maxRetries: 2 });
    return async (fact, sources) => {
      // Streamed, like every call to an OpenAI-compatible server.
      const stream = await client.chat.completions.create({ model: config.models.debrief, stream: true, messages: [{ role: "user", content: JUDGE_PROMPT(fact, sources) }] });
      let text = "";
      for await (const chunk of stream) text += chunk.choices[0]?.delta?.content ?? "";
      return verdict(text.replace(/<think>[\s\S]*?<\/think>/g, ""));
    };
  }
  return undefined;
}

const fetchImpl = args.offline ? (await import("../tests/unit/openDataFetch.ts")).fakeOpenDataFetch() : undefined;
const mapsTools = config.googleMapsServerKey && !args.offline ? new MapsAgentTools({ apiKey: config.googleMapsServerKey, log, version: config.version }) : undefined;
const grounding = new GroundingService({ config, mapsTools, fetchImpl, log });
console.log(`eval: ${config.aiProvider}${config.aiProvider === "demo" ? "" : ` (${config.model})`}, ${args.places} places${args.judge ? ", with a judge" : ""}${args.offline ? ", offline grounding" : ""}`);

const report = await runEvaluation({
  ai: createAI(config, log),
  grounding,
  model: config.aiProvider === "demo" ? undefined : config.model,
  places: Math.max(1, Number(args.places) || 4),
  judge: args.judge ? judgeFor(config) : undefined,
  log,
});
await mapsTools?.close();

await mkdir(args.out!, { recursive: true });
await writeFile(`${args.out}/report.json`, JSON.stringify(report, null, 2));
const markdown = reportMarkdown(report);
await writeFile(`${args.out}/report.md`, markdown);
console.log(`\n${markdown}`);
if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, markdown, { flag: "a" });
if (args.strict && report.failures.length) process.exit(1);
