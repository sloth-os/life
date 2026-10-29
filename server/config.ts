import { existsSync } from "node:fs";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
/** Model calls the game makes; each can have its own model and effort. */
export const AI_TASKS = ["expedition", "persona", "scene", "turn", "hint", "debrief", "ask"] as const;
export type AiTask = (typeof AI_TASKS)[number];
export type AiProvider = "anthropic" | "openai" | "demo";
export type JsonMode = "json_schema" | "json_object" | "text";
/** auto: think only where the task's effort is high; off: never; model: leave it to the model. */
export type Thinking = "auto" | "off" | "model";
/** Which switch an OpenAI-compatible server reads: Qwen's `enable_thinking`, OpenAI's `reasoning_effort`, or none. */
export type ThinkingStyle = "qwen" | "openai" | "none";

export interface VoiceConfig {
  /** An OpenAI-compatible model that hears and speaks (Qwen-Omni, gpt-4o-audio…). */
  model: string;
  baseUrl?: string;
  apiKey?: string;
  /** Voice names: the first for locals using she/her, the second for he/him; others take turns. */
  voices: string[];
}

export interface ImageConfig {
  /** mm-gateway (github.com/sloth-os/mm-gateway), which holds the image provider's credentials. */
  gatewayUrl: string;
  apiKey: string;
  /** Pin a model; otherwise the gateway routes by its limits. */
  model?: string;
  width: number;
  height: number;
}

export interface ServerConfig {
  version: string;
  port: number;
  dev: boolean;
  /** Claude through the Anthropic SDK, any OpenAI-compatible API through the OpenAI SDK, or scripted Demo AI. */
  aiProvider: AiProvider;
  /** The default model; `models` may override it per task. */
  model: string;
  models: Record<AiTask, string>;
  aiApiKey?: string;
  aiBaseUrl?: string;
  /** Structured-output mode to try first with OpenAI-compatible servers (falls back automatically). */
  openaiJsonMode: JsonMode;
  thinking: Thinking;
  /** AI_THINKING_STYLE, or "auto" to tell from each task's model name. */
  thinkingStyle: ThinkingStyle | "auto";
  effort: Record<AiTask, Effort>;
  voice?: VoiceConfig;
  images?: ImageConfig;
  mapsMode: "google" | "open";
  googleMapsApiKey?: string;
  googleMapId: string;
  /** Key for Maps Experience agent tools (MCP). */
  googleMapsServerKey?: string;
  /** Walking times from the arrival point to each local, via the agent tools' compute_routes (billed per route). */
  mapsWalkingRoutes: boolean;
  /** Classroom mode keeps classes and their results on disk under `dataDir`. */
  classroom: boolean;
  dataDir: string;
  accessCode?: string;
  /** AI requests per player per 10 minutes (a shared IP gets 10× this). */
  rateLimitPer10Min: number;
  /** Express "trust proxy" setting, so rate limits see real client IPs behind a load balancer. */
  trustProxy: boolean | number;
  userAgent: string;
  wikipediaLang: string;
}

const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

function pickEffort(value: string | undefined, fallback: Effort): Effort {
  return value && (EFFORTS as readonly string[]).includes(value) ? (value as Effort) : fallback;
}

export function loadDotEnv(path = ".env"): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

const PROVIDER_ALIASES: Record<string, AiProvider | "auto"> = {
  auto: "auto",
  anthropic: "anthropic",
  claude: "anthropic",
  openai: "openai",
  "openai-compatible": "openai",
  openai_compatible: "openai",
  demo: "demo",
};

type AiSettings = Pick<ServerConfig, "aiProvider" | "model" | "aiApiKey" | "aiBaseUrl">;

const valueOf =
  (env: NodeJS.ProcessEnv) =>
  (...names: string[]): string | undefined =>
    names.map((n) => env[n]?.trim()).find(Boolean) || undefined;

/**
 * AI_PROVIDER / AI_MODEL / AI_API_KEY / AI_BASE_URL work for either provider; the
 * provider-specific variables (ANTHROPIC_*, CLAUDE_MODEL, OPENAI_*) are fallbacks.
 * Left on "auto", an Anthropic key selects Claude, then an OpenAI key, else Demo AI.
 */
export function resolveAi(env: NodeJS.ProcessEnv): AiSettings {
  const setting = (env.AI_PROVIDER || env.AI_MODE || "auto").trim().toLowerCase();
  const requested = PROVIDER_ALIASES[setting];
  if (!requested) throw new Error(`Unknown AI_PROVIDER "${setting}" (use anthropic, openai or demo).`);
  const value = valueOf(env);
  const provider: AiProvider =
    requested !== "auto" ? requested : value("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN") ? "anthropic" : value("OPENAI_API_KEY") ? "openai" : "demo";

  if (provider === "anthropic") {
    return {
      aiProvider: provider,
      model: value("AI_MODEL", "CLAUDE_MODEL") ?? "claude-opus-5-5",
      aiApiKey: value("AI_API_KEY", "ANTHROPIC_API_KEY"),
      aiBaseUrl: value("AI_BASE_URL", "ANTHROPIC_BASE_URL"),
    };
  }
  if (provider === "openai") {
    const model = value("AI_MODEL", "OPENAI_MODEL");
    if (!model) throw new Error("Set AI_MODEL (or OPENAI_MODEL) to use an OpenAI-compatible API.");
    return { aiProvider: provider, model, aiApiKey: value("AI_API_KEY", "OPENAI_API_KEY"), aiBaseUrl: value("AI_BASE_URL", "OPENAI_BASE_URL") };
  }
  return { aiProvider: "demo", model: "" };
}

/** AI_MODEL_<TASK> (e.g. AI_MODEL_EXPEDITION) overrides the model for one task. */
export function resolveModels(env: NodeJS.ProcessEnv, model: string): Record<AiTask, string> {
  const value = valueOf(env);
  return Object.fromEntries(AI_TASKS.map((task) => [task, value(`AI_MODEL_${task.toUpperCase()}`) ?? model])) as Record<AiTask, string>;
}

/** The thinking switch a model's server most likely understands, from the model's name. */
export function detectThinkingStyle(model: string): ThinkingStyle {
  if (/qwen|qwq/i.test(model)) return "qwen";
  if (/^(o[1-9]|gpt-5|gpt-oss)/i.test(model)) return "openai";
  return "none";
}

/** Voice needs a model that hears and speaks; it shares the AI endpoint and key unless VOICE_* says otherwise. */
export function resolveVoice(env: NodeJS.ProcessEnv, ai: AiSettings): VoiceConfig | undefined {
  const value = valueOf(env);
  const model = value("VOICE_MODEL");
  if (!model || value("VOICE") === "off") return undefined;
  const sharesEndpoint = ai.aiProvider === "openai" && (!value("VOICE_BASE_URL") || value("VOICE_BASE_URL") === ai.aiBaseUrl);
  return {
    model,
    baseUrl: value("VOICE_BASE_URL") ?? (ai.aiProvider === "openai" ? ai.aiBaseUrl : undefined),
    apiKey: value("VOICE_API_KEY") ?? (sharesEndpoint ? ai.aiApiKey : undefined),
    voices: (value("VOICE_VOICES") ?? "Cherry,Ethan")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  };
}

export function resolveImages(env: NodeJS.ProcessEnv): ImageConfig | undefined {
  const value = valueOf(env);
  const gatewayUrl = value("MM_GATEWAY_URL");
  const apiKey = value("MM_GATEWAY_API_KEY");
  if (!gatewayUrl || !apiKey || value("POSTCARD_IMAGES") === "off") return undefined;
  const [width, height] = (value("IMAGE_SIZE") ?? "1536x1024").split("x").map(Number);
  return {
    gatewayUrl: gatewayUrl.replace(/\/+$/, ""),
    apiKey,
    model: value("IMAGE_MODEL"),
    width: width && width >= 256 ? width : 1536,
    height: height && height >= 256 ? height : 1024,
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, argv: string[] = process.argv): ServerConfig {
  const ai = resolveAi(env);
  const value = valueOf(env);
  const jsonMode = value("OPENAI_JSON_MODE");
  const thinking = value("AI_THINKING");

  const browserKey = value("GOOGLE_MAPS_API_KEY");
  const mapsSetting = (env.MAPS_MODE ?? "auto").toLowerCase();
  const mapsMode = mapsSetting === "open" || !browserKey ? "open" : "google";

  return {
    version: "0.2.0",
    port: Number(env.PORT ?? 8787),
    dev: argv.includes("--dev") || env.NODE_ENV === "development",
    ...ai,
    models: resolveModels(env, ai.model),
    openaiJsonMode: jsonMode === "json_object" || jsonMode === "text" ? jsonMode : "json_schema",
    thinking: thinking === "off" || thinking === "model" ? thinking : "auto",
    thinkingStyle: (["qwen", "openai", "none"] as const).find((s) => s === value("AI_THINKING_STYLE")?.toLowerCase()) ?? "auto",
    effort: {
      expedition: pickEffort(env.EFFORT_EXPEDITION, "medium"),
      persona: pickEffort(env.EFFORT_PERSONA, "medium"),
      scene: pickEffort(env.EFFORT_SCENE, "medium"),
      turn: pickEffort(env.EFFORT_TURN, "low"),
      hint: pickEffort(env.EFFORT_HINT, "low"),
      debrief: pickEffort(env.EFFORT_DEBRIEF, "medium"),
      ask: pickEffort(env.EFFORT_ASK, "low"),
    },
    voice: resolveVoice(env, ai),
    images: resolveImages(env),
    mapsMode,
    googleMapsApiKey: mapsMode === "google" ? browserKey : undefined,
    googleMapId: value("GOOGLE_MAPS_MAP_ID") ?? "DEMO_MAP_ID",
    googleMapsServerKey: mapsMode === "google" ? value("GOOGLE_MAPS_SERVER_KEY") : undefined,
    mapsWalkingRoutes: value("MAPS_WALKING_ROUTES") === "true",
    classroom: value("CLASSROOM") !== "off",
    dataDir: value("DATA_DIR") ?? "data",
    accessCode: value("ACCESS_CODE"),
    rateLimitPer10Min: Number(env.RATE_LIMIT_PER_10MIN ?? 120),
    trustProxy: env.TRUST_PROXY === "true" ? 1 : Number(env.TRUST_PROXY) > 0 ? Number(env.TRUST_PROXY) : false,
    userAgent: value("APP_USER_AGENT") ?? "CommonGround/0.2 (educational game; https://github.com/sloth-os/life)",
    wikipediaLang: value("WIKIPEDIA_LANG") ?? "en",
  };
}
