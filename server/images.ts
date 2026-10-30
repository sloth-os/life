// Postcard illustrations through mm-gateway (github.com/sloth-os/mm-gateway): the gateway holds the
// image provider's credentials and routes the request; the game creates a task, polls it, and
// returns the image. The prompt names only the place and the themes: never Google Maps content.
import { randomBytes } from "node:crypto";
import type { PostcardRequest } from "../shared/schemas.ts";
import type { LensId } from "../shared/world.ts";
import type { ImageConfig } from "./config.ts";
import { HttpError } from "./util/errors.ts";

const THEMES: Record<LensId, string> = {
  nature: "its landscape, plants and weather",
  culture: "its architecture, crafts and traditions",
  history: "its old streets and landmarks",
  society: "everyday street life and gathering places",
  economy: "its markets, workshops and small trades",
};

/** The postcard prompt: the place the player chose and the themes they explored, nothing from Google Maps. */
export function postcardPrompt(request: PostcardRequest): string {
  const place = [request.label, request.country].filter(Boolean).join(", ");
  const themes = [...new Set(request.lenses)].map((l) => THEMES[l]).join("; ") || "its everyday life";
  return `A hand-painted vintage travel postcard of ${place}, celebrating ${themes}. Gouache and watercolour on textured paper, warm natural light, rich but gentle colours, a wide scenic view. Respectful and true to the place, without clichés or stereotypes. People only as small figures in the distance. No text, no lettering, no logos, no border.`;
}

interface GatewayTask {
  id: string;
  status: "pending" | "running" | "succeeded" | "failed" | "cancelled" | "expired";
  model?: string;
  outputs?: { uri: string; mime_type?: string | null }[];
  error?: { code?: string; message?: string } | null;
}

export interface RenderedImage {
  bytes: Buffer;
  mimeType: string;
  model: string;
  ms: number;
}

export interface ImageGatewayOptions {
  config: ImageConfig;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
  /** Poll interval and overall deadline (tests shorten them). */
  pollMs?: number;
  deadlineMs?: number;
}

const TERMINAL = new Set(["succeeded", "failed", "cancelled", "expired"]);
/** A provider's moderation sometimes refuses what it generated, not what it was asked: ask again once. */
const OUTPUT_REFUSED = /OutputImageSensitiveContent|output.*(sensitive|inappropriate)/i;

export class ImageGateway {
  readonly #opts: ImageGatewayOptions;
  readonly #fetch: typeof fetch;

  constructor(opts: ImageGatewayOptions) {
    this.#opts = opts;
    this.#fetch = opts.fetchImpl ?? fetch;
  }

  async #call<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
    const { config } = this.#opts;
    let response: Response;
    try {
      response = await this.#fetch(`${config.gatewayUrl}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json", ...(init.headers ?? {}) },
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new HttpError(503, "images_unreachable", "Couldn't reach the image service.");
    }
    const text = await response.text();
    let body: unknown = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { detail: text.slice(0, 200) };
    }
    if (!response.ok) {
      const detail = (body as { detail?: string; title?: string }).detail ?? (body as { title?: string }).title ?? text.slice(0, 200);
      this.#opts.log?.(`[images] ${init.method ?? "GET"} ${path} → ${response.status}: ${detail}`);
      throw new HttpError(response.status === 429 ? 429 : 502, response.status === 429 ? "images_busy" : "images_failed", response.status === 429 ? "The postcard printer is busy — try again in a minute." : "The postcard couldn't be painted this time.");
    }
    return { status: response.status, body: body as T };
  }

  /** The image models the gateway offers this key: a cheap check that the URL and key work. */
  async models(signal?: AbortSignal): Promise<string[]> {
    const { body } = await this.#call<{ data?: { id: string }[] }>("/v1/models?modality=image", { signal });
    return (body.data ?? []).map((m) => m.id);
  }

  async render(prompt: string, signal?: AbortSignal): Promise<RenderedImage> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.#render(prompt, attempt, signal);
      } catch (error) {
        if (attempt === 0 && error instanceof HttpError && error.code === "images_refused") continue;
        throw error;
      }
    }
  }

  async #render(prompt: string, attempt: number, signal?: AbortSignal): Promise<RenderedImage> {
    const { config } = this.#opts;
    const started = Date.now();
    const created = await this.#call<GatewayTask>("/v1/images", {
      method: "POST",
      signal,
      headers: { "idempotency-key": `life-${randomBytes(12).toString("hex")}-${attempt}` },
      body: JSON.stringify({
        input: [{ type: "text", text: prompt }],
        ...(config.model ? { model: config.model } : {}),
        parameters: { dimensions: { width: config.width, height: config.height }, output_count: 1, watermark: false },
        metadata: { app: "common-ground" },
      }),
    });
    let task = created.body;
    const deadline = started + (this.#opts.deadlineMs ?? 180_000);
    while (!TERMINAL.has(task.status)) {
      if (Date.now() > deadline) throw new HttpError(504, "images_timeout", "The postcard is taking too long to paint.");
      await new Promise((r) => setTimeout(r, this.#opts.pollMs ?? 1500));
      if (signal?.aborted) throw new HttpError(499, "aborted", "Request cancelled.");
      task = (await this.#call<GatewayTask>(`/v1/images/${encodeURIComponent(task.id)}`, { signal })).body;
    }
    if (task.status !== "succeeded" || !task.outputs?.length) {
      const reason = `${task.error?.code ?? task.status}: ${task.error?.message ?? ""}`.slice(0, 300);
      this.#opts.log?.(`[images] task ${task.id} ${reason}`);
      if (OUTPUT_REFUSED.test(reason)) throw new HttpError(502, "images_refused", "The postcard couldn't be painted this time.");
      throw new HttpError(502, "images_failed", "The postcard couldn't be painted this time.");
    }
    const output = task.outputs[0]!;
    const image = await this.#download(output.uri, output.mime_type ?? undefined, signal);
    this.#opts.log?.(`[images] ${task.model ?? config.model ?? "auto"} ${Date.now() - started}ms ${image.mimeType} ${Math.round(image.bytes.length / 1024)}KB`);
    return { ...image, model: task.model ?? config.model ?? "auto", ms: Date.now() - started };
  }

  /** Inline data URIs decode in place; provider URLs are fetched here, with a few tries. */
  async #download(uri: string, mimeType: string | undefined, signal?: AbortSignal): Promise<{ bytes: Buffer; mimeType: string }> {
    const inline = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(uri);
    if (inline) return { bytes: Buffer.from(inline[3]!, inline[2] ? "base64" : "utf8"), mimeType: inline[1] ?? mimeType ?? "image/png" };
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await this.#fetch(uri, { signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return { bytes: Buffer.from(await response.arrayBuffer()), mimeType: response.headers.get("content-type")?.split(";")[0] ?? mimeType ?? "image/jpeg" };
      } catch (error) {
        if (attempt >= 3 || signal?.aborted) {
          this.#opts.log?.(`[images] download failed: ${error instanceof Error ? error.message : String(error)}`);
          throw new HttpError(502, "images_failed", "The postcard couldn't be delivered.");
        }
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }
}
