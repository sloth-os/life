import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import OpenAI from "openai";
import { ClaudeGameAI } from "./ai/claude.ts";
import { DemoGameAI } from "./ai/demo.ts";
import { OpenAIGameAI } from "./ai/openai.ts";
import { VoiceService } from "./ai/voice.ts";
import { ImageGateway } from "./images.ts";
import type { GameAI } from "./ai/types.ts";
import { createApp } from "./app.ts";
import { loadConfig, loadDotEnv } from "./config.ts";
import { GameEngine } from "./game/engine.ts";
import { GroundingService } from "./grounding/index.ts";
import { MapsAgentTools } from "./grounding/mapsAgentTools.ts";

loadDotEnv();
const config = loadConfig();
const log = (message: string) => console.log(message);

const mapsTools = config.googleMapsServerKey ? new MapsAgentTools({ apiKey: config.googleMapsServerKey, log, version: config.version }) : undefined;
const grounding = new GroundingService({ config, mapsTools, log });
function createAI(): GameAI {
  switch (config.aiProvider) {
    case "anthropic":
      return new ClaudeGameAI({ client: new Anthropic({ apiKey: config.aiApiKey, baseURL: config.aiBaseUrl, maxRetries: 2 }), model: config.model, models: config.models, effort: config.effort, log });
    case "openai":
      // Local servers (Ollama, vLLM) often need no key; the SDK insists on one.
      return new OpenAIGameAI({
        client: new OpenAI({ apiKey: config.aiApiKey ?? "not-needed", baseURL: config.aiBaseUrl, maxRetries: 2 }),
        model: config.model,
        models: config.models,
        jsonMode: config.openaiJsonMode,
        thinking: config.thinking,
        thinkingStyle: config.thinkingStyle,
        effort: config.effort,
        log,
      });
    default:
      return new DemoGameAI();
  }
}
const ai = createAI();
const voice = config.voice
  ? new VoiceService({ client: new OpenAI({ apiKey: config.voice.apiKey ?? "not-needed", baseURL: config.voice.baseUrl, maxRetries: 1 }), model: config.voice.model, voices: config.voice.voices, log })
  : undefined;
const images = config.images ? new ImageGateway({ config: config.images, log }) : undefined;
const engine = new GameEngine({ ai, grounding });
const app = createApp({ config, engine, grounding, voice, images, log });

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (config.dev) {
  const { createServer } = await import("vite");
  const vite = await createServer({ root, server: { middlewareMode: true }, appType: "spa" });
  app.use(vite.middlewares);
} else {
  const dist = path.join(root, "dist", "client");
  app.use(express.static(dist, { index: false, maxAge: "1h" }));
  app.use((req, res, next) => {
    if (req.method !== "GET") return next();
    res.sendFile(path.join(dist, "index.html"));
  });
}

const server = app.listen(config.port, () => {
  const lines = [
    `\n  🌍 Common Ground is running at http://localhost:${config.port}`,
    `     AI:   ${
      config.aiProvider === "anthropic"
        ? `Claude (${config.model})`
        : config.aiProvider === "openai"
          ? `OpenAI-compatible (${config.model}${config.aiBaseUrl ? ` at ${new URL(config.aiBaseUrl).host}` : ""})`
          : "Demo AI (scripted) — set ANTHROPIC_API_KEY, or AI_PROVIDER=openai with AI_MODEL"
    }`,
    `     Voice: ${config.voice ? `${config.voice.model} (voices ${config.voice.voices.join(", ")})` : "browser speech where available — set VOICE_MODEL for an omni voice model"}`,
    `     Postcards: ${config.images ? `${config.images.model ?? "auto"} through mm-gateway` : "off — set MM_GATEWAY_URL and MM_GATEWAY_API_KEY"}`,
    `     Maps: ${config.mapsMode === "google" ? "Google Maps" : "Open map mode — set GOOGLE_MAPS_API_KEY for Google Maps"}`,
    `     Place grounding: ${grounding.placeGrounding === "google" ? "Maps Experience agent tools + Wikipedia" : "Wikipedia"}${config.mapsMode === "google" && !mapsTools ? " (set GOOGLE_MAPS_SERVER_KEY to enable Maps agent tools)" : ""}`,
    config.accessCode ? "     Access code: required" : "",
  ];
  console.log(lines.filter(Boolean).join("\n") + "\n");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close();
    void mapsTools?.close();
    process.exit(0);
  });
}
