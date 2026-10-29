import { existsSync } from "node:fs";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type AiTask = "expedition" | "persona" | "turn" | "hint" | "debrief";
export type AiProvider = "anthropic" | "openai" | "demo";
export type JsonMode = "json_schema" | "json_object" | "text";

export interface ServerConfig {
  version: string;
  port: number;
  dev: boolean;
  /** Claude through the Anthropic SDK, any OpenAI-compatible API through the OpenAI SDK, or scripted Demo AI. */
  aiProvider: AiProvider;
  model: string;
  aiApiKey?: string;
  aiBaseUrl?: string;
  /** Structured-output mode to try first with OpenAI-compatible servers (falls back automatically). */
  openaiJsonMode: JsonMode;
  effort: Record<AiTask, Effort>;
  mapsMode: "google" | "open";
  googleMapsApiKey?: string;
  googleMapId: string;
  /** Key for Maps Experience agent tools (MCP). */
  googleMapsServerKey?: string;
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

/**
 * AI_PROVIDER / AI_MODEL / AI_API_KEY / AI_BASE_URL work for either provider; the
 * provider-specific variables (ANTHROPIC_*, CLAUDE_MODEL, OPENAI_*) are fallbacks.
 * Left on "auto", an Anthropic key selects Claude, then an OpenAI key, else Demo AI.
 */
export function resolveAi(env: NodeJS.ProcessEnv): AiSettings {
  const setting = (env.AI_PROVIDER || env.AI_MODE || "auto").trim().toLowerCase();
  const requested = PROVIDER_ALIASES[setting];
  if (!requested) throw new Error(`Unknown AI_PROVIDER "${setting}" (use anthropic, openai or demo).`);
  const value = (...names: string[]) => names.map((n) => env[n]?.trim()).find(Boolean) || undefined;
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env, argv: string[] = process.argv): ServerConfig {
  const ai = resolveAi(env);
  const jsonMode = env.OPENAI_JSON_MODE?.trim();

  const browserKey = env.GOOGLE_MAPS_API_KEY?.trim() || undefined;
  const mapsSetting = (env.MAPS_MODE ?? "auto").toLowerCase();
  const mapsMode = mapsSetting === "open" || !browserKey ? "open" : "google";

  return {
    version: "0.1.0",
    port: Number(env.PORT ?? 8787),
    dev: argv.includes("--dev") || env.NODE_ENV === "development",
    ...ai,
    openaiJsonMode: jsonMode === "json_object" || jsonMode === "text" ? jsonMode : "json_schema",
    effort: {
      expedition: pickEffort(env.EFFORT_EXPEDITION, "medium"),
      persona: pickEffort(env.EFFORT_PERSONA, "medium"),
      turn: pickEffort(env.EFFORT_TURN, "low"),
      hint: pickEffort(env.EFFORT_HINT, "low"),
      debrief: pickEffort(env.EFFORT_DEBRIEF, "medium"),
    },
    mapsMode,
    googleMapsApiKey: mapsMode === "google" ? browserKey : undefined,
    googleMapId: env.GOOGLE_MAPS_MAP_ID?.trim() || "DEMO_MAP_ID",
    googleMapsServerKey: mapsMode === "google" ? env.GOOGLE_MAPS_SERVER_KEY?.trim() || undefined : undefined,
    accessCode: env.ACCESS_CODE?.trim() || undefined,
    rateLimitPer10Min: Number(env.RATE_LIMIT_PER_10MIN ?? 120),
    trustProxy: env.TRUST_PROXY === "true" ? 1 : Number(env.TRUST_PROXY) > 0 ? Number(env.TRUST_PROXY) : false,
    userAgent: env.APP_USER_AGENT?.trim() || "CommonGround/0.1 (educational game; https://github.com/)",
    wikipediaLang: env.WIKIPEDIA_LANG?.trim() || "en",
  };
}
