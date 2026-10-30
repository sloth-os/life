// The services a configuration calls for: the AI, grounding, voice, postcards and classes. When
// the settings change, `apply` rebuilds only the services whose part of the configuration
// changed and swaps them in. Requests already running finish with the services they started
// with; the next request gets the new ones. No restart, and nothing in progress is cut off.
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type pg from "pg";
import type { RuntimeStatus, ServiceName } from "../shared/settings.ts";
import { ClaudeGameAI } from "./ai/claude.ts";
import { DemoGameAI } from "./ai/demo.ts";
import { OpenAIGameAI } from "./ai/openai.ts";
import type { GameAI } from "./ai/types.ts";
import { VoiceService } from "./ai/voice.ts";
import { ClassroomStore } from "./classroom/store.ts";
import type { ServerConfig } from "./config.ts";
import { GameEngine } from "./game/engine.ts";
import { GroundingService } from "./grounding/index.ts";
import { MapsAgentTools } from "./grounding/mapsAgentTools.ts";
import { ImageGateway } from "./images.ts";
import type { FetchLike } from "./util/http.ts";

export interface Services {
  config: ServerConfig;
  engine: GameEngine;
  grounding: GroundingService;
  /** Voice mode: present when a voice model is configured. */
  voice?: VoiceService;
  /** Postcard illustrations: present when mm-gateway is configured. */
  images?: ImageGateway;
  /** Classroom mode: present when enabled (CLASSROOM, on by default). */
  classroom?: ClassroomStore;
  /** Counts configuration changes, so browsers can tell theirs is out of date. */
  revision: number;
}

export interface RuntimeOptions {
  log: (message: string) => void;
  /** Postgres, when DATABASE_URL is set: classes are kept there instead of under DATA_DIR. */
  pool?: pg.Pool;
  /** Tests: a different AI, or a fake network for grounding. */
  createAI?: (config: ServerConfig) => GameAI;
  fetchImpl?: FetchLike;
}

export function createAI(config: ServerConfig, log: (message: string) => void): GameAI {
  switch (config.aiProvider) {
    case "anthropic":
      return new ClaudeGameAI({
        // null rather than undefined, so the SDK doesn't reach for ANTHROPIC_* variables the settings page overrode.
        client: new Anthropic({ apiKey: config.aiApiKey ?? null, baseURL: config.aiBaseUrl ?? null, maxRetries: 2 }),
        model: config.model,
        models: config.models,
        effort: config.effort,
        log,
      });
    case "openai":
      // Local servers (Ollama, vLLM) often need no key; the SDK insists on one.
      return new OpenAIGameAI({
        client: new OpenAI({ apiKey: config.aiApiKey ?? "not-needed", baseURL: config.aiBaseUrl ?? null, maxRetries: 2 }),
        model: config.model,
        models: config.models,
        jsonMode: config.openaiJsonMode,
        thinking: config.thinking,
        thinkingStyle: config.thinkingStyle,
        effort: config.effort,
        maxTokens: config.maxTokens,
        log,
      });
    default:
      return new DemoGameAI();
  }
}

/** The parts of the configuration each service is built from. */
function fingerprints(config: ServerConfig): Record<ServiceName, string> {
  const { aiProvider, model, models, aiApiKey, aiBaseUrl, openaiJsonMode, thinking, thinkingStyle, effort, maxTokens } = config;
  return {
    ai: JSON.stringify({ aiProvider, model, models, aiApiKey, aiBaseUrl, openaiJsonMode, thinking, thinkingStyle, effort, maxTokens }),
    maps: JSON.stringify([config.mapsMode, config.googleMapsServerKey ?? ""]),
    grounding: JSON.stringify([config.mapsMode, config.userAgent, config.wikipediaLang, config.mapsWalkingRoutes]),
    voice: JSON.stringify(config.voice ?? null),
    images: JSON.stringify(config.images ?? null),
    classroom: JSON.stringify([config.classroom, config.dataDir, config.databaseUrl ?? ""]),
    access: JSON.stringify([config.accessCode ?? "", config.rateLimitPer10Min, config.trustProxy, config.googleMapsApiKey ?? "", config.googleMapId]),
  };
}

export class Runtime {
  readonly #opts: RuntimeOptions;
  #services: Services;
  #fingerprints: Record<ServiceName, string>;
  #mapsTools: MapsAgentTools | undefined;
  /**
   * Opened once: where classes live is a start-up setting, so turning classes off and on again
   * reuses the same store rather than opening a second one over the same file.
   */
  #classStore: Promise<ClassroomStore | undefined> | null = null;
  #applying: Promise<unknown> = Promise.resolve();

  private constructor(opts: RuntimeOptions, services: Services, mapsTools: MapsAgentTools | undefined) {
    this.#opts = opts;
    this.#services = services;
    this.#mapsTools = mapsTools;
    this.#fingerprints = fingerprints(services.config);
  }

  static async start(config: ServerConfig, opts: RuntimeOptions): Promise<Runtime> {
    const mapsTools = Runtime.#maps(config, opts);
    const grounding = new GroundingService({ config, mapsTools, fetchImpl: opts.fetchImpl, log: opts.log });
    const ai = opts.createAI?.(config) ?? createAI(config, opts.log);
    const services: Services = {
      config,
      grounding,
      engine: new GameEngine({ ai, grounding, log: opts.log }),
      voice: Runtime.#voice(config, opts),
      images: Runtime.#images(config, opts),
      classroom: undefined,
      // From the boot time, so a restarted server never repeats a revision a browser has seen.
      revision: Date.now(),
    };
    const runtime = new Runtime(opts, services, mapsTools);
    services.classroom = await runtime.#classroom(config);
    return runtime;
  }

  static #maps(config: ServerConfig, opts: RuntimeOptions): MapsAgentTools | undefined {
    return config.googleMapsServerKey ? new MapsAgentTools({ apiKey: config.googleMapsServerKey, log: opts.log, version: config.version }) : undefined;
  }

  static #voice(config: ServerConfig, opts: RuntimeOptions): VoiceService | undefined {
    const voice = config.voice;
    if (!voice) return undefined;
    const client = new OpenAI({ apiKey: voice.apiKey ?? "not-needed", baseURL: voice.baseUrl ?? null, maxRetries: 1 });
    return new VoiceService({ client, model: voice.model, ttsModel: voice.ttsModel, voices: voice.voices, log: opts.log });
  }

  static #images(config: ServerConfig, opts: RuntimeOptions): ImageGateway | undefined {
    return config.images ? new ImageGateway({ config: config.images, log: opts.log }) : undefined;
  }

  /** Classroom mode needs somewhere to write; without it the game runs, just without classes. */
  #classroom(config: ServerConfig): Promise<ClassroomStore | undefined> {
    if (!config.classroom) return Promise.resolve(undefined);
    const { pool, log } = this.#opts;
    this.#classStore ??= (pool ? ClassroomStore.openShared(pool) : ClassroomStore.open(config.dataDir)).catch((error: unknown) => {
      log(`[classroom] off: can't use ${pool ? "the database" : config.dataDir} (${error instanceof Error ? error.message : String(error)})`);
      this.#classStore = null;
      return undefined;
    });
    return this.#classStore;
  }

  get current(): Services {
    return this.#services;
  }

  get mapsTools(): MapsAgentTools | undefined {
    return this.#mapsTools;
  }

  /** What is running, for the settings page and the start-up banner. */
  status(): RuntimeStatus {
    const { config, engine, grounding, voice, images, classroom } = this.#services;
    const host = (url?: string) => {
      try {
        return url ? new URL(url).host : undefined;
      } catch {
        return undefined;
      }
    };
    return {
      ai: { mode: engine.aiMode, model: engine.aiMode === "demo" ? undefined : config.model, endpoint: host(config.aiBaseUrl) },
      voice: { listen: voice?.model, speak: voice?.ttsModel && voice.canSpeak !== false ? "tts" : voice?.model && voice.canSpeak !== false ? "model" : "browser", tts: voice?.ttsModel },
      postcards: { on: Boolean(images), model: config.images?.model },
      maps: { mode: config.mapsMode, grounding: grounding.placeGrounding, walkingRoutes: grounding.placeGrounding === "google" && config.mapsWalkingRoutes },
      classroom: { on: Boolean(classroom), store: classroom?.kind },
      accessCode: Boolean(config.accessCode),
    };
  }

  /** Switch to a new configuration; returns the services that changed. Changes apply one at a time. */
  apply(config: ServerConfig): Promise<ServiceName[]> {
    const run = this.#applying.then(() => this.#apply(config));
    this.#applying = run.catch(() => {});
    return run;
  }

  async #apply(config: ServerConfig): Promise<ServiceName[]> {
    const next = fingerprints(config);
    const changed = (Object.keys(next) as ServiceName[]).filter((name) => next[name] !== this.#fingerprints[name]);
    if (!changed.length) return [];
    const old = this.#services;
    const services: Services = { ...old, config, revision: old.revision + 1 };
    const retire: (() => Promise<void>)[] = [];

    if (changed.includes("maps")) {
      const previous = this.#mapsTools;
      this.#mapsTools = Runtime.#maps(config, this.#opts);
      // Calls already under way keep their session for a while.
      if (previous) retire.push(() => new Promise((resolve) => setTimeout(() => void previous.close().finally(resolve), 120_000).unref()));
    }
    if (changed.includes("maps") || changed.includes("grounding")) {
      old.grounding.reconfigure({ config, mapsTools: this.#mapsTools });
    }
    if (changed.includes("ai")) {
      const ai = this.#opts.createAI?.(config) ?? createAI(config, this.#opts.log);
      services.engine = new GameEngine({ ai, grounding: old.grounding, log: this.#opts.log });
    }
    if (changed.includes("voice")) services.voice = Runtime.#voice(config, this.#opts);
    if (changed.includes("images")) services.images = Runtime.#images(config, this.#opts);
    if (changed.includes("classroom")) {
      // Turned off: write what's pending, but keep the store for when classes come back.
      await old.classroom?.flush();
      services.classroom = await this.#classroom(config);
    }

    this.#services = services;
    this.#fingerprints = next;
    for (const done of retire) void done();
    return changed;
  }

  async close(): Promise<void> {
    await this.#applying;
    await this.#mapsTools?.close();
    await (await this.#classStore)?.close();
  }
}
