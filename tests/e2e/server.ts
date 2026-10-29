// The real app for browser tests: built client + API + Demo AI, with grounding
// served from fixtures so tests don't depend on Wikipedia or weather services.
import path from "node:path";
import express from "express";
import { DemoGameAI } from "../../server/ai/demo.ts";
import { createApp } from "../../server/app.ts";
import { loadConfig } from "../../server/config.ts";
import { GameEngine } from "../../server/game/engine.ts";
import { GroundingService } from "../../server/grounding/index.ts";
import { fakeOpenDataFetch } from "../unit/openDataFetch.ts";

const port = Number(process.env.E2E_PORT ?? 8790);
const config = { ...loadConfig({}, []), port };
const grounding = new GroundingService({ config, fetchImpl: fakeOpenDataFetch(), log: () => {} });
const engine = new GameEngine({ ai: new DemoGameAI({ typingDelayMs: 4 }), grounding });
const app = createApp({ config, engine, grounding });

const dist = path.resolve("dist/client");
app.use(express.static(dist, { index: false }));
app.use((req, res, next) => (req.method === "GET" ? res.sendFile(path.join(dist, "index.html")) : next()));
app.listen(port, "127.0.0.1", () => console.log(`e2e server on http://127.0.0.1:${port}`));
