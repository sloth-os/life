import { existsSync } from "node:fs";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type AiTask = "expedition" | "persona" | "turn" | "hint" | "debrief";

export interface ServerConfig {
  version: string;
  port: number;
  dev: boolean;
  aiMode: "claude" | "demo";
  model: string;
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env, argv: string[] = process.argv): ServerConfig {
  const hasClaudeCredentials = Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);
  const aiSetting = (env.AI_MODE ?? "auto").toLowerCase();
  const aiMode = aiSetting === "claude" || (aiSetting === "auto" && hasClaudeCredentials) ? "claude" : "demo";

  const browserKey = env.GOOGLE_MAPS_API_KEY?.trim() || undefined;
  const mapsSetting = (env.MAPS_MODE ?? "auto").toLowerCase();
  const mapsMode = mapsSetting === "open" || !browserKey ? "open" : "google";

  return {
    version: "0.1.0",
    port: Number(env.PORT ?? 8787),
    dev: argv.includes("--dev") || env.NODE_ENV === "development",
    aiMode,
    model: env.CLAUDE_MODEL?.trim() || "claude-opus-5-5",
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
