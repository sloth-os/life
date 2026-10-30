// A new key for the settings page, for when the one printed at first start is lost. The old key
// stops working at once, on every instance. Not needed (or possible) while ADMIN_KEY is set.
//   node scripts/settings-key.ts            (in Docker: docker exec <container> node scripts/settings-key.ts)
import { createHash, randomBytes } from "node:crypto";
import pg from "pg";
import { loadConfig } from "../server/config.ts";
import { layerEnv, readDotEnv } from "../server/settings/env.ts";
import { FileSettingsStore, PostgresSettingsStore } from "../server/settings/store.ts";

const config = loadConfig(layerEnv(process.env, readDotEnv(), {}));
if (config.adminKey) {
  console.error("ADMIN_KEY is set, so the settings page uses it: change it there instead.");
  process.exit(1);
}
const pool = config.databaseUrl ? new pg.Pool({ connectionString: config.databaseUrl, max: 1 }) : undefined;
try {
  const store = pool ? await PostgresSettingsStore.open(pool) : await FileSettingsStore.open(config.dataDir);
  const key = randomBytes(18).toString("base64url");
  await store.setAdminKeyHash(createHash("sha256").update(key).digest("hex"), false);
  await store.close();
  console.log(`New settings page key: ${key}\n(the old key no longer works; ${pool ? "every instance sharing the database" : "a running server"} picks this up without a restart)`);
} finally {
  await pool?.end();
}
