import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createApp } from "./app.ts";
import { loadConfig, type ServerConfig } from "./config.ts";
import { openDatabase, type Database } from "./db.ts";
import { Runtime } from "./runtime.ts";
import { layerEnv, readDotEnv } from "./settings/env.ts";
import { SettingsService } from "./settings/service.ts";
import { openSettingsStore, type SettingsStore } from "./settings/store.ts";

const log = (message: string) => console.log(message);
// The environment as the server got it; .env and the settings page are layered over it, so a change
// to either applies without a restart.
const processEnv = { ...process.env };
const DOT_ENV = ".env";

/**
 * A configuration from these variables, or, if their AI settings can't run (an OpenAI-compatible
 * provider without a model, say), the same with Demo AI: the server still starts, and the
 * settings page can put it right.
 */
function configFrom(env: Record<string, string | undefined>, what: string): ServerConfig {
  try {
    return loadConfig(env);
  } catch (error) {
    log(`[settings] ${what} can't run (${error instanceof Error ? error.message : String(error)}); using Demo AI until that's fixed (on the settings page, for one)`);
    return loadConfig({ ...env, AI_PROVIDER: "demo" });
  }
}

// Where to listen, where to keep data and the settings key are read once, from the environment and .env.
const boot = configFrom(layerEnv(processEnv, readDotEnv(DOT_ENV), {}), "the environment's AI settings");
let db: Database | undefined;
try {
  db = boot.databaseUrl ? await openDatabase(boot.databaseUrl, { connections: 10, log }) : undefined;
} catch (error) {
  console.error(`\n  Common Ground can't use its database: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

const store: SettingsStore | undefined = await openSettingsStore(db, boot.dataDir, log).catch((error: unknown) => {
  log(`[settings] can't keep settings in ${db ? "the database" : boot.dataDir} (${error instanceof Error ? error.message : String(error)}); the settings page is off`);
  return undefined;
});
// With the page off, the server runs on its environment alone, even if values were saved earlier.
const pageValues = () => (boot.settingsPage ? (store?.current().values ?? {}) : {});
if (!boot.settingsPage && Object.keys(store?.current().values ?? {}).length) log("[settings] SETTINGS_PAGE=off: values saved on the settings page are ignored");

const initial = Object.keys(pageValues()).length ? configFrom(layerEnv(processEnv, readDotEnv(DOT_ENV), pageValues()), "the saved AI settings") : boot;

const runtime = await Runtime.start(initial, { log, db });
const settings = store ? new SettingsService({ store, runtime, processEnv, dotEnvPath: DOT_ENV, usePage: boot.settingsPage, log }) : undefined;
settings?.watch();
const newKey = boot.settingsPage ? await settings?.ensureKey() : null;

const app = createApp({ services: () => runtime.current, settings: boot.settingsPage ? settings : undefined, log });

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (initial.dev) {
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

// Express 5 calls back with the error when it can't listen (the port is taken, say).
const server = app.listen(boot.port, (error?: Error) => {
  if (error) {
    console.error(`\n  Common Ground couldn't listen on port ${boot.port}: ${error.message}\n`);
    process.exit(1);
  }
  const status = runtime.status();
  const config = runtime.current.config;
  const url = `http://localhost:${boot.port}`;
  const lines = [
    `\n  🌍 Common Ground is running at ${url}`,
    `     AI:   ${
      status.ai.mode === "claude"
        ? `Claude (${config.model})`
        : status.ai.mode === "openai"
          ? `OpenAI-compatible (${config.model}${status.ai.endpoint ? ` at ${status.ai.endpoint}` : ""})`
          : "Demo AI (scripted) — choose a model on the settings page, or set ANTHROPIC_API_KEY, or AI_PROVIDER=openai with AI_MODEL"
    }`,
    `     Voice: ${config.voice ? [config.voice.model && `hears with ${config.voice.model}`, config.voice.ttsModel ? `speaks with ${config.voice.ttsModel}` : `voices ${config.voice.voices.join(", ")}`].filter(Boolean).join("; ") : "browser speech where available — set VOICE_MODEL for an omni voice model"}`,
    `     Postcards: ${config.images ? `${config.images.model ?? "auto"} through mm-gateway` : "off — set MM_GATEWAY_URL and MM_GATEWAY_API_KEY"}`,
    `     Classroom: ${status.classroom.on ? `on (${status.classroom.store === "postgres" ? "Postgres, shared" : status.classroom.store === "sqlite" && db?.kind === "sqlite" ? `SQLite, ${db.file}` : `data in ${config.dataDir}`})` : "off"}`,
    `     Maps: ${status.maps.mode === "google" ? "Google Maps" : "Open map mode — set GOOGLE_MAPS_API_KEY for Google Maps"}`,
    `     Place grounding: ${status.maps.grounding === "google" ? "Maps Experience agent tools + Wikipedia" : "Wikipedia"}${config.mapsMode === "google" && !runtime.mapsTools ? " (set GOOGLE_MAPS_SERVER_KEY to enable Maps agent tools)" : ""}`,
    config.accessCode ? "     Access code: required" : "",
    !boot.settingsPage || !settings
      ? "     Settings page: off"
      : newKey
        ? `     Settings page: ${url}/#settings — key ${newKey}\n       (shown this once: keep it, set ADMIN_KEY to choose your own, or run \`node scripts/settings-key.ts\` for a new one)`
        : `     Settings page: ${url}/#settings — ${settings.keySource === "env" ? "key from ADMIN_KEY" : "key printed at first start (`node scripts/settings-key.ts` makes a new one)"}; changes apply without a restart`,
  ];
  console.log(lines.filter(Boolean).join("\n") + "\n");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close();
    settings?.close();
    void Promise.allSettled([runtime.close(), store?.close()])
      .then(() => db?.close())
      .finally(() => process.exit(0));
  });
}
