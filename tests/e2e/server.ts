// The real app for browser tests: built client + API + Demo AI, with grounding served from
// fixtures so tests don't depend on Wikipedia or weather services. It runs the real runtime and
// settings page (key: e2e-settings-key), so tests can change settings and see them apply.
// With E2E_FAKE_VOICE=1 it also serves a fake voice model, so voice mode can be tested anywhere.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { DemoGameAI } from "../../server/ai/demo.ts";
import { createApp } from "../../server/app.ts";
import { loadConfig } from "../../server/config.ts";
import { Runtime } from "../../server/runtime.ts";
import { SettingsService } from "../../server/settings/service.ts";
import { FileSettingsStore } from "../../server/settings/store.ts";
import { fakeOpenDataFetch } from "../unit/openDataFetch.ts";
import { startFakeVoiceModel } from "./fakeVoice.ts";

const port = Number(process.env.E2E_PORT ?? 8790);
const host = process.env.E2E_HOST ?? "127.0.0.1";
// Settings and classes live in a fresh temporary folder for each test run.
const dataDir = await mkdtemp(path.join(tmpdir(), "life-e2e-"));
const processEnv: Record<string, string> = { DATA_DIR: dataDir, ADMIN_KEY: "e2e-settings-key", PORT: String(port) };
if (process.env.E2E_FAKE_VOICE === "1") {
  const voice = await startFakeVoiceModel();
  Object.assign(processEnv, { VOICE_MODEL: "fake-omni", VOICE_BASE_URL: voice.url, VOICE_API_KEY: "fake" });
}
const log = (message: string) => (process.env.E2E_LOG ? console.log(message) : undefined);
const store = await FileSettingsStore.open(dataDir);
const runtime = await Runtime.start(loadConfig(processEnv, []), {
  log,
  createAI: () => new DemoGameAI({ typingDelayMs: 4 }),
  fetchImpl: fakeOpenDataFetch(),
});
const settings = new SettingsService({ store, runtime, processEnv, log });
const app = createApp({ services: () => runtime.current, settings, log });

const dist = path.resolve("dist/client");
app.use(express.static(dist, { index: false }));
app.use((req, res, next) => (req.method === "GET" ? res.sendFile(path.join(dist, "index.html")) : next()));
app.listen(port, host, () => console.log(`e2e server on http://${host}:${port}`));
