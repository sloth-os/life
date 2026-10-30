// The configuration a server started now would use: the environment, .env and the values saved on
// the settings page. For scripts (the probe, the evaluation) that should test what the game runs.
import { loadConfig, type ServerConfig } from "../config.ts";
import { openDatabase, type Database } from "../db.ts";
import { layerEnv, readDotEnv } from "./env.ts";
import { openSettingsStore } from "./store.ts";

export async function loadEffectiveConfig(processEnv: NodeJS.ProcessEnv = process.env): Promise<ServerConfig> {
  const dotEnv = readDotEnv();
  const boot = loadConfig(layerEnv(processEnv, dotEnv, {}));
  if (!boot.settingsPage) return boot;
  let page: Record<string, string> = {};
  let db: Database | undefined;
  try {
    db = boot.databaseUrl ? await openDatabase(boot.databaseUrl, { connections: 1, log: () => {} }) : undefined;
    const store = await openSettingsStore(db, boot.dataDir);
    page = store.current().values;
    await store.close();
  } catch {
    // No saved settings to read: the environment alone.
  } finally {
    await db?.close();
  }
  return loadConfig(layerEnv(processEnv, dotEnv, page));
}
