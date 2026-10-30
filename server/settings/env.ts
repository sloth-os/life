// Where configuration comes from, lowest priority first: the .env file, the process environment,
// then values saved on the settings page. Process variables win over .env as Node's own loader
// has them do, and the page wins over both until a value is reset there.
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { SETTINGS, settingDef, type SettingDef, type SettingState } from "../../shared/settings.ts";

export type Env = Record<string, string | undefined>;

/** Variables in a .env file, or none when there isn't one (or it can't be read). */
export function readDotEnv(path = ".env"): Env {
  try {
    return parseEnv(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

/** The environment the server configures itself from. */
export function layerEnv(processEnv: Env, dotEnv: Env, page: Record<string, string>): Env {
  const env: Env = { ...dotEnv };
  for (const [key, value] of Object.entries(processEnv)) if (value !== undefined) env[key] = value;
  for (const [key, value] of Object.entries(page)) {
    // Start-up settings come from the environment only, even if someone writes them into the file.
    if (settingDef(key)?.bootstrap) continue;
    env[key] = value;
    // Emptied on the page means emptied: a variable that stands in for it mustn't fill the gap.
    if (value === "") for (const alias of settingDef(key)?.aliases ?? []) env[alias] = "";
  }
  return env;
}

/** The last few characters of a secret, enough to tell two keys apart. */
export function secretHint(value: string): string {
  return value.length >= 12 ? `…${value.slice(-4)}` : "•".repeat(Math.min(value.length, 8));
}

function fromEnv(def: SettingDef, base: Env): { key: string; value: string } | undefined {
  for (const key of [def.key, ...(def.aliases ?? [])]) {
    const value = base[key]?.trim();
    if (value) return { key, value };
  }
  return undefined;
}

/** Each setting's value and where it comes from, without the secrets themselves. */
export function describeSettings(base: Env, page: Record<string, string>): Record<string, SettingState> {
  const states: Record<string, SettingState> = {};
  for (const def of SETTINGS) {
    const secret = def.kind === "secret";
    const env = fromEnv(def, base);
    const state: SettingState = { source: "default" };
    if (env) {
      state.envKey = env.key;
      if (secret) state.envHint = secretHint(env.value);
      else state.envValue = env.value;
    }
    if (!def.bootstrap && def.key in page) {
      const value = page[def.key]!;
      state.source = "page";
      if (secret) state.hint = value ? secretHint(value) : "";
      else state.value = value;
    } else if (env) {
      state.source = "env";
      if (secret) state.hint = state.envHint;
      else state.value = env.value;
    } else if (!secret) {
      state.value = def.fallback ?? "";
    }
    states[def.key] = state;
  }
  return states;
}
