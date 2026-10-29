import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import {
  AskRequestSchema,
  DebriefRequestSchema,
  ExpeditionRequestSchema,
  HintRequestSchema,
  ListenRequestSchema,
  PersonaRequestSchema,
  PostcardRequestSchema,
  PronounceRequestSchema,
  SpeakRequestSchema,
  TurnRequestSchema,
  VOICE_MAX_SECONDS,
  type AppConfig,
  type Heard,
  type PronunciationResult,
} from "../shared/schemas.ts";
import { isWav, wavDurationMs, type VoiceService } from "./ai/voice.ts";
import { postcardPrompt, type ImageGateway } from "./images.ts";
import type { ServerConfig } from "./config.ts";
import type { EngineEvent, GameEngine, OnEngineEvent } from "./game/engine.ts";
import type { GroundingService } from "./grounding/index.ts";
import { RateLimiter } from "./util/cache.ts";
import { HttpError } from "./util/errors.ts";
import { openEventStream, wantsEvents } from "./util/sse.ts";

export interface AppDeps {
  config: ServerConfig;
  engine: GameEngine;
  grounding: GroundingService;
  /** Voice mode: present when a voice model is configured. */
  voice?: VoiceService;
  /** Postcard illustrations: present when mm-gateway is configured. */
  images?: ImageGateway;
  log?: (message: string) => void;
}

/** A recorded answer: a WAV of real speech length, or a 400. */
function decodeAudio(base64: string): Buffer {
  const wav = Buffer.from(base64, "base64");
  if (!isWav(wav)) throw new HttpError(400, "invalid_audio", "The recording wasn't a WAV file.");
  const ms = wavDurationMs(wav);
  if (ms < 300) throw new HttpError(400, "too_short", "That recording was too short — hold the button a little longer.");
  if (ms > VOICE_MAX_SECONDS * 1000 + 500) throw new HttpError(400, "too_long", `Keep it under ${VOICE_MAX_SECONDS} seconds.`);
  return wav;
}

function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, "invalid_request", z.prettifyError(result.error).slice(0, 600));
  return result.data;
}

/** Abort upstream AI work when the player navigates away mid-request. */
function abortOnClose(res: Response): AbortSignal {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) controller.abort();
  });
  return controller.signal;
}

export function createApp(deps: AppDeps): express.Express {
  const { config, engine, grounding, voice, images } = deps;
  const log = deps.log ?? ((m: string) => console.error(m));
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);

  const api = express.Router();
  // Recordings travel as base64 WAV, so voice routes take larger bodies than the rest.
  const smallJson = express.json({ limit: "256kb" });
  const audioJson = express.json({ limit: "4mb" });
  api.use((req, res, next) => (req.path.startsWith("/voice/") ? audioJson : smallJson)(req, res, next));

  const clientConfig: AppConfig = {
    version: config.version,
    mapsMode: config.mapsMode,
    aiMode: engine.aiMode,
    model: engine.aiMode === "demo" ? undefined : config.model,
    googleMapsApiKey: config.googleMapsApiKey,
    googleMapId: config.mapsMode === "google" ? config.googleMapId : undefined,
    placeGrounding: grounding.placeGrounding,
    accessCodeRequired: Boolean(config.accessCode),
    features: {
      voice: Boolean(voice),
      voiceOutput: voice && voice.canSpeak !== false ? "model" : "browser",
      postcards: Boolean(images),
      classroom: config.classroom,
      flyIns: config.mapsMode === "google",
    },
  };

  api.get("/health", (_req, res) => {
    res.json({ ok: true, version: config.version });
  });

  api.get("/config", (_req, res) => {
    // Whether the voice model can speak is learned on first use.
    res.json({ ...clientConfig, features: { ...clientConfig.features, voiceOutput: voice && voice.canSpeak !== false ? "model" : "browser" } });
  });

  api.use((req, _res, next) => {
    if (config.accessCode && req.get("x-access-code") !== config.accessCode) {
      throw new HttpError(401, "access_code", "This game needs an access code. Ask your teacher or host for it.");
    }
    next();
  });

  // Per player (a browser-generated id) so a classroom behind one IP isn't throttled as one
  // person, with a per-IP ceiling so rotating ids doesn't bypass the limit.
  const perPlayer = new RateLimiter(config.rateLimitPer10Min, 10 * 60 * 1000);
  const perIp = new RateLimiter(config.rateLimitPer10Min * 10, 10 * 60 * 1000);
  const rateLimit = (req: Request, _res: Response, next: NextFunction) => {
    const ip = req.ip ?? "unknown";
    const player = (req.get("x-client-id") ?? "").slice(0, 64);
    if (!perIp.allow(ip) || !perPlayer.allow(`${ip}:${player}`)) {
      throw new HttpError(429, "rate_limited", "You're exploring fast! Take a short breather and try again in a minute.");
    }
    next();
  };

  api.get("/geo/search", rateLimit, async (req, res) => {
    const q = parse(z.string().trim().min(2).max(120), req.query.q);
    res.json({ results: await grounding.search(q) });
  });

  /**
   * A long model call answers with one JSON body, or, when the browser asks for
   * `text/event-stream`, with `progress` (and `briefing`) events and then `result`.
   */
  async function respond<T>(req: Request, res: Response, tag: string, work: (signal: AbortSignal, onEvent?: OnEngineEvent) => Promise<T>): Promise<void> {
    const signal = abortOnClose(res);
    if (!wantsEvents(req)) {
      res.json(await work(signal));
      return;
    }
    const events = openEventStream(res, log, tag);
    try {
      const onEvent = (event: EngineEvent) => events.send(event.type, event.type === "progress" ? event.progress : event.briefing);
      events.send("result", await work(signal, onEvent));
    } catch (error) {
      events.fail(error, "Something went wrong on our side. Try again.");
    } finally {
      events.close();
    }
  }

  api.post("/expedition", rateLimit, async (req, res) => {
    const body = parse(ExpeditionRequestSchema, req.body);
    await respond(req, res, "expedition", (signal, onEvent) => engine.createExpedition(body, signal, onEvent));
  });

  api.post("/npc/persona", rateLimit, async (req, res) => {
    const body = parse(PersonaRequestSchema, req.body);
    await respond(req, res, "persona", (signal, onEvent) => engine.createPersona(body, signal, onEvent));
  });

  // Server-sent events: `reply` snapshots while the local speaks, then `result`.
  api.post("/npc/turn", rateLimit, async (req, res) => {
    const body = parse(TurnRequestSchema, req.body);
    const signal = abortOnClose(res);
    const events = openEventStream(res, log, "turn");
    try {
      events.send("result", await engine.turn(body, (text) => events.send("reply", { text }), signal));
    } catch (error) {
      events.fail(error, "Something went wrong mid-conversation. Try sending that again.");
    } finally {
      events.close();
    }
  });

  api.post("/coach/hint", rateLimit, async (req, res) => {
    const body = parse(HintRequestSchema, req.body);
    res.json(await engine.hint(body, abortOnClose(res)));
  });

  // Server-sent events: `answer` snapshots while the mentor writes, then `result`.
  api.post("/coach/ask", rateLimit, async (req, res) => {
    const body = parse(AskRequestSchema, req.body);
    const signal = abortOnClose(res);
    const events = openEventStream(res, log, "ask");
    try {
      events.send("result", await engine.ask(body, (text) => events.send("answer", { text }), signal));
    } catch (error) {
      events.fail(error, "Your mentor lost their train of thought. Try asking again.");
    } finally {
      events.close();
    }
  });

  api.post("/coach/debrief", rateLimit, async (req, res) => {
    const body = parse(DebriefRequestSchema, req.body);
    await respond(req, res, "debrief", (signal, onEvent) => engine.debrief(body, signal, onEvent));
  });

  // ── Voice mode ──────────────────────────────────────────────────────────
  const requireVoice = (): VoiceService => {
    if (!voice) throw new HttpError(404, "voice_off", "Voice mode isn't set up on this server.");
    return voice;
  };

  api.post("/voice/speak", rateLimit, async (req, res) => {
    const service = requireVoice();
    const body = parse(SpeakRequestSchema, req.body);
    const name = service.voiceFor(body.pronouns ?? "", body.seed ?? body.text);
    const spoken = await service.speak(body.text, name, abortOnClose(res));
    res.set({ "Content-Type": "audio/wav", "Cache-Control": "private, max-age=3600", "X-Voice": name }).send(spoken.wav);
  });

  api.post("/voice/listen", rateLimit, async (req, res) => {
    const service = requireVoice();
    const body = parse(ListenRequestSchema, req.body);
    const heard = await service.listen(decodeAudio(body.audio), body.context ?? "The learner is talking with a local.", abortOnClose(res));
    const result: Heard = { transcript: heard.transcript.trim().slice(0, 600), tone: heard.tone, pace: heard.pace, clarity: Math.max(0, Math.min(100, heard.clarity)), note: heard.note.trim().slice(0, 240) };
    res.json(result);
  });

  api.post("/voice/pronounce", rateLimit, async (req, res) => {
    const service = requireVoice();
    const body = parse(PronounceRequestSchema, req.body);
    const scored = await service.pronounce(decodeAudio(body.audio), { phrase: body.phrase, language: body.language, meaning: body.meaning }, abortOnClose(res));
    const result: PronunciationResult = { transcript: scored.transcript.trim().slice(0, 200), score: Math.max(0, Math.min(100, scored.score)), tip: scored.tip.trim().slice(0, 300) };
    res.json(result);
  });

  // ── Postcards ───────────────────────────────────────────────────────────
  // Images cost more than text, so a player gets a few per hour, and each trip's postcard is kept.
  const postcardLimit = new RateLimiter(6, 60 * 60 * 1000);
  const painted = new Map<string, { bytes: Buffer; mimeType: string }>();
  api.post("/postcard", rateLimit, async (req, res) => {
    if (!images) throw new HttpError(404, "postcards_off", "Postcards aren't set up on this server.");
    const body = parse(PostcardRequestSchema, req.body);
    let image = painted.get(body.expeditionId);
    if (!image) {
      if (!postcardLimit.allow(`${req.ip ?? "unknown"}:${(req.get("x-client-id") ?? "").slice(0, 64)}`)) {
        throw new HttpError(429, "rate_limited", "That's a lot of postcards! The printer needs a rest — try again later.");
      }
      image = await images.render(postcardPrompt(body), abortOnClose(res));
      painted.set(body.expeditionId, image);
      if (painted.size > 50) painted.delete(painted.keys().next().value!);
    }
    res.set({ "Content-Type": image.mimeType, "Cache-Control": "private, max-age=86400" }).send(image.bytes);
  });

  api.use((_req, res) => {
    res.status(404).json({ error: "not_found", message: "No such endpoint." });
  });

  api.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    if (error instanceof HttpError) {
      if (error.status >= 500) log(`[api] ${error.code}: ${error.message}`);
      res.status(error.status).json({ error: error.code, message: error.message });
      return;
    }
    const status = (error as { status?: number }).status;
    if (status === 413) {
      res.status(413).json({ error: "too_large", message: "That request was too large." });
      return;
    }
    if (status === 400) {
      res.status(400).json({ error: "invalid_json", message: "The request body wasn't valid JSON." });
      return;
    }
    log(`[api] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    res.status(500).json({ error: "internal", message: "Something went wrong on our side." });
  });

  app.use("/api", api);
  return app;
}
