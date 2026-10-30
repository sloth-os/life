// The configuration a server started now would use: the environment, .env and the values saved on
// the settings page. For scripts (the probe, the evaluation) that should test what the game runs.
import pg from "pg";
import { loadConfig, type ServerConfig } from "../config.ts";
import { layerEnv, readDotEnv } from "./env.ts";
import { FileSettingsStore, PostgresSettingsStore } from "./store.ts";

export async function loadEffectiveConfig(processEnv: NodeJS.ProcessEnv = process.env): Promise<ServerConfig> {
  const dotEnv = readDotEnv();
  const boot = loadConfig(layerEnv(processEnv, dotEnv, {}));
  if (!boot.settingsPage) return boot;
  let page: Record<string, string> = {};
  const pool = boot.databaseUrl ? new pg.Pool({ connectionString: boot.databaseUrl, max: 1 }) : undefined;
  try {
    const store = pool ? await PostgresSettingsStore.open(pool) : await FileSettingsStore.open(boot.dataDir);
    page = store.current().values;
    await store.close();
  } catch {
    // No saved settings to read: the environment alone.
  } finally {
    await pool?.end();
  }
  return loadConfig(layerEnv(processEnv, dotEnv, page));
}
