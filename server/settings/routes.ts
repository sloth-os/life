// /api/admin: the settings page's API. Everything but `status` needs the settings key in the
// X-Admin-Key header. Wrong keys are counted per IP, and after too many the IP waits, right key or
// not, so a weak ADMIN_KEY can't be guessed by trying.
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { SETTING_MAX_LENGTH } from "../../shared/settings.ts";
import { RateLimiter } from "../util/cache.ts";
import { HttpError } from "../util/errors.ts";
import type { SettingsService } from "./service.ts";

const UpdateSchema = z.object({
  values: z.record(z.string().max(80), z.string().max(SETTING_MAX_LENGTH).nullable()),
  revision: z.number().int().min(0).optional(),
});
const ProbeSchema = z.object({
  target: z.enum(["ai", "voice", "images", "maps"]),
  values: z.record(z.string().max(80), z.string().max(SETTING_MAX_LENGTH).nullable()).default({}),
});

function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, "invalid_request", z.prettifyError(result.error).slice(0, 600));
  return result.data;
}

export function adminRoutes(service: SettingsService | undefined): express.Router {
  const router = express.Router();
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  router.get("/status", (_req, res) => {
    res.json({ enabled: Boolean(service), keySource: service?.keySource ?? null });
  });

  if (!service) {
    router.use(() => {
      throw new HttpError(404, "settings_off", "The settings page is turned off on this server (SETTINGS_PAGE=off).");
    });
    return router;
  }

  const wrongKeys = new RateLimiter(20, 15 * 60 * 1000);
  const requireKey = (req: Request, _res: Response, next: NextFunction) => {
    const ip = req.ip ?? "unknown";
    if (wrongKeys.blocked(ip)) throw new HttpError(429, "admin_locked", "Too many wrong keys. Wait a few minutes and try again.");
    if (!service.verify(req.get("x-admin-key") ?? undefined)) {
      wrongKeys.allow(ip);
      throw new HttpError(401, "admin_key", "That isn't the settings key.");
    }
    next();
  };

  // Checks a key without doing anything with it (the page's unlock form).
  router.post("/session", requireKey, (_req, res) => {
    res.status(204).end();
  });

  router.get("/settings", requireKey, (_req, res) => {
    res.json(service.view());
  });

  router.put("/settings", requireKey, async (req, res) => {
    res.json(await service.update(parse(UpdateSchema, req.body)));
  });

  router.post("/test", requireKey, async (req, res) => {
    const body = parse(ProbeSchema, req.body);
    res.json(await service.probe(body.target, body.values));
  });

  router.post("/key", requireKey, async (_req, res) => {
    res.json({ key: await service.rotateKey() });
  });

  return router;
}
