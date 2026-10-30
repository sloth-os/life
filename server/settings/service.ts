// The settings page's server side: what each setting is and where it comes from, saving changes
// and applying them without a restart (hot reload), and the key that guards it all. Changes made
// outside the page (an edit to settings.json or .env, another instance saving) apply the same way.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { SETTINGS, describeProblem, invalidSetting, settingDef, type ProbeResult, type ProbeTarget, type SettingsSaved, type SettingsUpdate, type SettingsView } from "../../shared/settings.ts";
import { loadConfig, type ServerConfig } from "../config.ts";
import type { Runtime } from "../runtime.ts";
import { HttpError } from "../util/errors.ts";
import { describeSettings, layerEnv, readDotEnv, type Env } from "./env.ts";
import { probe } from "./probes.ts";
import type { SettingsStore } from "./store.ts";

const hash = (key: string) => createHash("sha256").update(key).digest("hex");

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export interface SettingsServiceOptions {
  store: SettingsStore;
  runtime: Runtime;
  /** The process environment as the server started with it (without .env). */
  processEnv: Env;
  /** The .env file to read and watch, if any. */
  dotEnvPath?: string;
  /** False when the page is off (SETTINGS_PAGE=off): saved values are ignored, the environment rules. */
  usePage?: boolean;
  log: (message: string) => void;
  /** Tests replace the network checks. */
  probe?: (target: ProbeTarget, config: ServerConfig) => Promise<ProbeResult>;
}

/** Problems that don't stop the server but leave something off that was probably meant to be on. */
export function warningsFor(config: ServerConfig, env: Env): string[] {
  const set = (key: string) => Boolean(env[key]?.trim());
  const warnings: string[] = [];
  const provider = (env.AI_PROVIDER || env.AI_MODE || "auto").trim().toLowerCase();
  if (provider === "auto" && set("AI_API_KEY") && !set("ANTHROPIC_API_KEY") && !set("ANTHROPIC_AUTH_TOKEN") && !set("OPENAI_API_KEY")) {
    warnings.push("AI_API_KEY is set, but AI_PROVIDER is auto, which only looks for ANTHROPIC_API_KEY or OPENAI_API_KEY. Choose a provider to use the key.");
  }
  if (config.aiProvider === "openai" && !config.aiBaseUrl && !config.aiApiKey) warnings.push("The OpenAI-compatible provider has neither a base URL nor an API key.");
  if ((env.MAPS_MODE ?? "").trim().toLowerCase() === "google" && !set("GOOGLE_MAPS_API_KEY")) warnings.push("MAPS_MODE is google, but there's no GOOGLE_MAPS_API_KEY: the open map is used until there is one.");
  if (set("GOOGLE_MAPS_SERVER_KEY") && config.mapsMode !== "google") warnings.push("GOOGLE_MAPS_SERVER_KEY is only used with Google Maps (it needs GOOGLE_MAPS_API_KEY too).");
  if (config.mapsWalkingRoutes && !config.googleMapsServerKey) warnings.push("Walking routes need GOOGLE_MAPS_SERVER_KEY.");
  if (set("MM_GATEWAY_URL") !== set("MM_GATEWAY_API_KEY")) warnings.push("Postcards need both MM_GATEWAY_URL and MM_GATEWAY_API_KEY.");
  if (config.voice && !config.voice.baseUrl && config.aiProvider !== "openai") warnings.push("Voice uses the AI endpoint only with AI_PROVIDER=openai: set VOICE_BASE_URL and VOICE_API_KEY.");
  return warnings;
}

export class SettingsService {
  readonly #opts: SettingsServiceOptions;
  #dotEnv: Env;
  #dotEnvWatcher: FSWatcher | null = null;
  #dotEnvTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: SettingsServiceOptions) {
    this.#opts = opts;
    this.#dotEnv = opts.dotEnvPath ? readDotEnv(opts.dotEnvPath) : {};
  }

  /** The environment beneath the page's values: .env, then the process environment. */
  #base(): Env {
    return layerEnv(this.#opts.processEnv, this.#dotEnv, {});
  }

  env(page: Record<string, string> = this.#opts.usePage === false ? {} : this.#opts.store.current().values): Env {
    return layerEnv(this.#opts.processEnv, this.#dotEnv, page);
  }

  /** The configuration the current settings make. Throws (as a 400) if they don't make one. */
  config(page?: Record<string, string>): ServerConfig {
    try {
      return loadConfig(this.env(page), process.argv);
    } catch (error) {
      throw new HttpError(400, "invalid_settings", error instanceof Error ? error.message : String(error));
    }
  }

  view(): SettingsView {
    const stored = this.#opts.store.current();
    const env = this.env();
    let warnings: string[];
    try {
      warnings = warningsFor(loadConfig(env, process.argv), env);
    } catch (error) {
      warnings = [error instanceof Error ? error.message : String(error)];
    }
    return {
      revision: stored.revision,
      updatedAt: stored.updatedAt,
      settings: describeSettings(this.#base(), stored.values),
      status: this.#opts.runtime.status(),
      storage: this.#opts.store.kind,
      watchesDotEnv: Boolean(this.#dotEnvWatcher),
      warnings,
    };
  }

  /** The page's values after a change: set, or removed (back to the environment's). */
  #merge(update: SettingsUpdate["values"]): Record<string, string> {
    const values = { ...this.#opts.store.current().values };
    for (const [key, value] of Object.entries(update)) {
      const def = settingDef(key);
      if (!def) throw new HttpError(400, "unknown_setting", `There's no setting called ${key}.`);
      if (def.bootstrap) throw new HttpError(400, "bootstrap_setting", `${key} is read when the server starts: set it in the environment.`);
      if (value === null) {
        delete values[key];
        continue;
      }
      const problem = invalidSetting(def, value.trim());
      if (problem) throw new HttpError(400, "invalid_setting", `${key} ${describeProblem(problem)}.`);
      values[key] = value.trim();
    }
    return values;
  }

  /** Save, then rebuild what the change touches. A configuration that can't start is refused, not saved. */
  async update(update: SettingsUpdate): Promise<SettingsSaved> {
    const values = this.#merge(update.values);
    const config = this.config(values);
    await this.#opts.store.save(values, update.revision);
    const applied = await this.#opts.runtime.apply(config);
    const changed = Object.keys(update.values).join(", ");
    this.#opts.log(`[settings] saved ${changed || "nothing"}; applied without a restart${applied.length ? ` (${applied.join(", ")})` : ""}`);
    return { ...this.view(), applied };
  }

  /** Apply settings changed outside the page. A broken change is logged and the running services stay. */
  async reload(reason: string): Promise<void> {
    let config: ServerConfig;
    try {
      config = loadConfig(this.env(), process.argv);
    } catch (error) {
      this.#opts.log(`[settings] ${reason}, but the result can't run (${error instanceof Error ? error.message : String(error)}); keeping the current settings`);
      return;
    }
    const applied = await this.#opts.runtime.apply(config);
    if (applied.length) this.#opts.log(`[settings] ${reason}: applied without a restart (${applied.join(", ")})`);
  }

  /** Follow edits to settings.json (or other instances' saves) and to .env. */
  watch(): void {
    this.#opts.store.onExternalChange(() => void this.reload(this.#opts.store.kind === "file" ? "settings.json changed" : "another instance saved settings"));
    const path = this.#opts.dotEnvPath;
    if (!path) return;
    const file = resolve(path);
    try {
      // The folder, so a .env created or replaced later is seen too.
      this.#dotEnvWatcher = watch(dirname(file), (_event, name) => {
        if (name !== basename(file)) return;
        if (this.#dotEnvTimer) clearTimeout(this.#dotEnvTimer);
        this.#dotEnvTimer = setTimeout(() => {
          this.#dotEnvTimer = null;
          const next = readDotEnv(file);
          if (JSON.stringify(next) === JSON.stringify(this.#dotEnv)) return;
          this.#dotEnv = next;
          void this.reload(".env changed");
        }, 150);
      });
      this.#dotEnvWatcher.unref();
    } catch (error) {
      this.#opts.log(`[settings] can't watch ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  close(): void {
    this.#dotEnvWatcher?.close();
    if (this.#dotEnvTimer) clearTimeout(this.#dotEnvTimer);
  }

  // ── The key ──────────────────────────────────────────────────────────────

  /** ADMIN_KEY from the environment, else a key the server generated. */
  get keySource(): "env" | "generated" {
    return this.#envKey() ? "env" : "generated";
  }

  #envKey(): string | undefined {
    return this.#base().ADMIN_KEY?.trim() || undefined;
  }

  verify(key: string | undefined): boolean {
    if (!key) return false;
    const envKey = this.#envKey();
    if (envKey) return sameHash(hash(key), hash(envKey));
    const stored = this.#opts.store.current().adminKeyHash;
    return Boolean(stored) && sameHash(hash(key), stored!);
  }

  /**
   * Without ADMIN_KEY, the first start makes a key and returns it, to be printed once; later starts
   * (and other instances sharing the store) return null.
   */
  async ensureKey(): Promise<string | null> {
    if (this.#envKey() || this.#opts.store.current().adminKeyHash) return null;
    const key = randomBytes(18).toString("base64url");
    return (await this.#opts.store.setAdminKeyHash(hash(key), true)) ? key : null;
  }

  /** A new generated key (the old one stops working). Not possible while ADMIN_KEY is set. */
  async rotateKey(): Promise<string> {
    if (this.#envKey()) throw new HttpError(409, "key_from_env", "The key comes from ADMIN_KEY: change it there.");
    const key = randomBytes(18).toString("base64url");
    await this.#opts.store.setAdminKeyHash(hash(key), false);
    this.#opts.log("[settings] the settings page has a new key");
    return key;
  }

  // ── Tests from the page ──────────────────────────────────────────────────

  /** Check a service with the form's values, saved or not. */
  probe(target: ProbeTarget, draft: SettingsUpdate["values"]): Promise<ProbeResult> {
    const config = this.config(this.#merge(draft));
    return (this.#opts.probe ?? probe)(target, config);
  }
}

/** Every setting the page can change (for the API's validation). */
export const EDITABLE_KEYS = SETTINGS.filter((s) => !s.bootstrap).map((s) => s.key);
