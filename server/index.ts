import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import { ClaudeGameAI } from "./ai/claude.ts";
import { DemoGameAI } from "./ai/demo.ts";
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
const ai =
  config.aiMode === "claude"
    ? new ClaudeGameAI({ client: new Anthropic({ maxRetries: 2 }), model: config.model, effort: config.effort, log })
    : new DemoGameAI();
const engine = new GameEngine({ ai, grounding });
const app = createApp({ config, engine, grounding, log });

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
    `     AI:   ${config.aiMode === "claude" ? `Claude (${config.model})` : "Demo AI (scripted) — set ANTHROPIC_API_KEY for Claude"}`,
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
