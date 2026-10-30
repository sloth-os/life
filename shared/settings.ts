// Server settings: every variable the server reads, described once. The server validates the
// settings page's changes with it and the page draws its form from it. Values are strings, as in
// the environment; a value set on the page overrides the environment's until it is reset.

/** Model calls the game makes; each can have its own model, effort and output cap. */
export const AI_TASKS = ["expedition", "persona", "scene", "turn", "hint", "debrief", "ask"] as const;
export type AiTask = (typeof AI_TASKS)[number];

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export const SETTING_GROUPS = ["ai", "tasks", "voice", "postcards", "maps", "classroom", "access", "openData"] as const;
export type SettingGroup = (typeof SETTING_GROUPS)[number];

/**
 * text and secret are free text (a secret is never sent back to the browser); url must be
 * http(s); select is one of `options`; toggle stores `on` or `off`.
 */
export type SettingKind = "text" | "secret" | "url" | "number" | "select" | "toggle";

export interface SettingDef {
  key: string;
  group: SettingGroup;
  kind: SettingKind;
  options?: readonly string[];
  /** For toggles: the stored values. */
  on?: string;
  off?: string;
  /** What applies when nothing sets it (the page shows it as the default). */
  fallback?: string;
  /** Other variables that set it when this one is unset, first match wins (ANTHROPIC_API_KEY…). */
  aliases?: readonly string[];
  min?: number;
  max?: number;
  /** Example input for an empty field. */
  example?: string;
  /** Per-task settings, shown as one table. */
  task?: AiTask;
  /** Read once when the server starts, so it is set in the environment (the page only shows it). */
  bootstrap?: boolean;
}

/** Default output caps (tokens) for OpenAI-compatible servers: room for a full answer, not a runaway. */
export const DEFAULT_MAX_TOKENS: Record<AiTask, number> = {
  expedition: 6000,
  persona: 3000,
  scene: 3000,
  turn: 1200,
  hint: 600,
  debrief: 4000,
  ask: 1200,
};

export const DEFAULT_EFFORT: Record<AiTask, Effort> = {
  expedition: "medium",
  persona: "medium",
  scene: "medium",
  turn: "low",
  hint: "low",
  debrief: "medium",
  ask: "low",
};

const perTask: SettingDef[] = AI_TASKS.flatMap((task): SettingDef[] => [
  { key: `AI_MODEL_${task.toUpperCase()}`, group: "tasks", kind: "text", task },
  { key: `EFFORT_${task.toUpperCase()}`, group: "tasks", kind: "select", options: EFFORTS, fallback: DEFAULT_EFFORT[task], task },
  { key: `AI_MAX_TOKENS_${task.toUpperCase()}`, group: "tasks", kind: "number", min: 0, max: 200_000, fallback: String(DEFAULT_MAX_TOKENS[task]), task },
]);

export const SETTINGS: readonly SettingDef[] = [
  // The AI behind the Game Master, the locals and the mentor.
  { key: "AI_PROVIDER", group: "ai", kind: "select", options: ["auto", "anthropic", "openai", "demo"], fallback: "auto", aliases: ["AI_MODE"] },
  { key: "AI_MODEL", group: "ai", kind: "text", aliases: ["CLAUDE_MODEL", "OPENAI_MODEL"], example: "claude-opus-5-5" },
  { key: "AI_BASE_URL", group: "ai", kind: "url", aliases: ["ANTHROPIC_BASE_URL", "OPENAI_BASE_URL"], example: "https://api.openai.com/v1" },
  { key: "AI_API_KEY", group: "ai", kind: "secret", aliases: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY"] },
  { key: "OPENAI_JSON_MODE", group: "ai", kind: "select", options: ["json_schema", "json_object", "text"], fallback: "json_schema" },
  { key: "AI_THINKING", group: "ai", kind: "select", options: ["auto", "off", "model"], fallback: "auto" },
  { key: "AI_THINKING_STYLE", group: "ai", kind: "select", options: ["qwen", "openai", "none"] },
  ...perTask,
  // Voice mode.
  { key: "VOICE", group: "voice", kind: "toggle", on: "on", off: "off", fallback: "on" },
  { key: "VOICE_MODEL", group: "voice", kind: "text", example: "qwen3-omni-flash" },
  { key: "VOICE_TTS_MODEL", group: "voice", kind: "text", example: "gpt-4o-mini-tts" },
  { key: "VOICE_BASE_URL", group: "voice", kind: "url" },
  { key: "VOICE_API_KEY", group: "voice", kind: "secret" },
  { key: "VOICE_VOICES", group: "voice", kind: "text", fallback: "Cherry,Ethan" },
  // Postcards through mm-gateway.
  { key: "POSTCARD_IMAGES", group: "postcards", kind: "toggle", on: "on", off: "off", fallback: "on" },
  { key: "MM_GATEWAY_URL", group: "postcards", kind: "url", example: "http://127.0.0.1:8792" },
  { key: "MM_GATEWAY_API_KEY", group: "postcards", kind: "secret" },
  { key: "IMAGE_MODEL", group: "postcards", kind: "text" },
  { key: "IMAGE_SIZE", group: "postcards", kind: "text", fallback: "1536x1024" },
  // Google Maps Platform.
  { key: "MAPS_MODE", group: "maps", kind: "select", options: ["auto", "google", "open"], fallback: "auto" },
  { key: "GOOGLE_MAPS_API_KEY", group: "maps", kind: "secret" },
  { key: "GOOGLE_MAPS_MAP_ID", group: "maps", kind: "text", fallback: "DEMO_MAP_ID" },
  { key: "GOOGLE_MAPS_SERVER_KEY", group: "maps", kind: "secret" },
  { key: "MAPS_WALKING_ROUTES", group: "maps", kind: "toggle", on: "true", off: "false", fallback: "false" },
  // Classroom mode.
  { key: "CLASSROOM", group: "classroom", kind: "toggle", on: "on", off: "off", fallback: "on" },
  { key: "DATA_DIR", group: "classroom", kind: "text", fallback: "data", bootstrap: true },
  { key: "DATABASE_URL", group: "classroom", kind: "secret", bootstrap: true },
  // Who may play, and how much.
  { key: "ACCESS_CODE", group: "access", kind: "text" },
  { key: "RATE_LIMIT_PER_10MIN", group: "access", kind: "number", min: 1, max: 100_000, fallback: "120" },
  { key: "TRUST_PROXY", group: "access", kind: "select", options: ["false", "true", "2", "3"], fallback: "false" },
  { key: "ADMIN_KEY", group: "access", kind: "secret", bootstrap: true },
  { key: "SETTINGS_PAGE", group: "access", kind: "toggle", on: "on", off: "off", fallback: "on", bootstrap: true },
  { key: "PORT", group: "access", kind: "number", fallback: "8787", bootstrap: true },
  // Wikipedia, Nominatim and Open-Meteo.
  { key: "APP_USER_AGENT", group: "openData", kind: "text", example: "CommonGround/0.3 (contact: you@example.org)" },
  { key: "WIKIPEDIA_LANG", group: "openData", kind: "text", fallback: "en" },
];

export const SETTING_KEYS = new Set(SETTINGS.map((s) => s.key));
export const settingDef = (key: string): SettingDef | undefined => SETTINGS.find((s) => s.key === key);

/** Most values are one line; nothing needs more than this. */
export const SETTING_MAX_LENGTH = 2000;

export type SettingProblem =
  | { code: "tooLong" | "oneLine" | "url" | "urlScheme" | "number" | "imageSize" | "wikiLang" }
  | { code: "min" | "max"; limit: number }
  | { code: "option"; options: readonly string[] };

/** Why a value can't be used for a setting, or null if it can. Empty means "nothing". */
export function invalidSetting(def: SettingDef, value: string): SettingProblem | null {
  if (value.length > SETTING_MAX_LENGTH) return { code: "tooLong" };
  if (/[\r\n\0]/.test(value)) return { code: "oneLine" };
  if (value === "") return null;
  switch (def.kind) {
    case "url":
      try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:" ? null : { code: "urlScheme" };
      } catch {
        return { code: "url" };
      }
    case "number": {
      if (!/^\d+$/.test(value)) return { code: "number" };
      const n = Number(value);
      if (def.min !== undefined && n < def.min) return { code: "min", limit: def.min };
      if (def.max !== undefined && n > def.max) return { code: "max", limit: def.max };
      return null;
    }
    case "select":
      return def.options?.includes(value) ? null : { code: "option", options: def.options ?? [] };
    case "toggle":
      return value === def.on || value === def.off ? null : { code: "option", options: [def.on ?? "on", def.off ?? "off"] };
    default:
      if (def.key === "IMAGE_SIZE" && !/^\d{3,4}x\d{3,4}$/.test(value)) return { code: "imageSize" };
      if (def.key === "WIKIPEDIA_LANG" && !/^[a-z]{2,3}(-[a-z]+)?$/.test(value)) return { code: "wikiLang" };
      return null;
  }
}

/** A problem in English, for the server's answers and logs (the page translates the code). */
export function describeProblem(problem: SettingProblem): string {
  switch (problem.code) {
    case "tooLong":
      return "is too long";
    case "oneLine":
      return "must be one line";
    case "url":
      return "isn't a URL";
    case "urlScheme":
      return "must start with http:// or https://";
    case "number":
      return "must be a whole number";
    case "min":
      return `must be at least ${problem.limit}`;
    case "max":
      return `must be at most ${problem.limit}`;
    case "option":
      return `must be one of ${problem.options.join(", ")}`;
    case "imageSize":
      return "must look like 1536x1024";
    case "wikiLang":
      return "must be a Wikipedia language code, like en";
  }
}

/** Where a setting's value comes from. */
export type SettingSource = "page" | "env" | "default";

export interface SettingState {
  source: SettingSource;
  /** The value in use (absent for secrets, which never leave the server). */
  value?: string;
  /** For secrets that are set: their last characters, to tell keys apart. */
  hint?: string;
  /** The variable that supplies it when the source is the environment (an alias, perhaps). */
  envKey?: string;
  /** What the environment says, shown so the page can tell what a reset would bring back. */
  envValue?: string;
  envHint?: string;
}

export type ServiceName = "ai" | "voice" | "images" | "maps" | "grounding" | "classroom" | "access";

/** Where settings and classes are kept: files under DATA_DIR, or the database DATABASE_URL names. */
export type StoreKind = "file" | "postgres" | "sqlite";

/** What the server is running right now. */
export interface RuntimeStatus {
  ai: { mode: "claude" | "openai" | "demo"; model?: string; endpoint?: string };
  voice: { listen?: string; speak: "model" | "tts" | "browser"; tts?: string };
  postcards: { on: boolean; model?: string };
  maps: { mode: "google" | "open"; grounding: "google" | "wikipedia"; walkingRoutes: boolean };
  classroom: { on: boolean; store?: StoreKind };
  accessCode: boolean;
}

export interface SettingsView {
  revision: number;
  updatedAt: number | null;
  settings: Record<string, SettingState>;
  status: RuntimeStatus;
  /** Where the page's values are kept. */
  storage: StoreKind;
  /** Also applied without a restart: edits to .env (when the server has one). */
  watchesDotEnv: boolean;
  /** Problems worth fixing that don't stop the server (a key without a provider…). */
  warnings: string[];
}

export interface SettingsUpdate {
  /** A value to set on the page, or null to go back to the environment's. */
  values: Record<string, string | null>;
  /** The revision the change was made against; a newer one on the server means someone else saved. */
  revision?: number;
}

export interface SettingsSaved extends SettingsView {
  /** Services rebuilt to apply the change. */
  applied: ServiceName[];
}

export type ProbeTarget = "ai" | "voice" | "images" | "maps";

export interface ProbeResult {
  ok: boolean;
  ms: number;
  /** What was reached, and how it answered (for people, not parsing). */
  message: string;
}
