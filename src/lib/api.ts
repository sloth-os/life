import type {
  ApiErrorBody,
  AppConfig,
  Debrief,
  DebriefRequest,
  Expedition,
  ExpeditionRequest,
  GeoResult,
  Hint,
  HintRequest,
  Persona,
  PersonaRequest,
  TurnRequest,
  TurnResult,
} from "../../shared/schemas.ts";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let accessCode = "";
export function setAccessCode(code: string): void {
  accessCode = code;
}

/** A random per-browser id, so rate limits apply per player rather than per shared school IP. */
const clientId = (() => {
  try {
    const existing = localStorage.getItem("common-ground:client");
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem("common-ground:client", id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
})();

function headers(json: boolean): HeadersInit {
  const h: Record<string, string> = { "X-Client-Id": clientId };
  if (json) h["Content-Type"] = "application/json";
  if (accessCode) h["X-Access-Code"] = accessCode;
  return h;
}

async function asError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    return new ApiError(response.status, body.error ?? "error", body.message ?? `Request failed (${response.status})`);
  } catch {
    return new ApiError(response.status, "error", `Request failed (${response.status})`);
  }
}

async function call<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: headers(body !== undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "offline", "Couldn't reach the game server. Check your connection.");
  }
  if (!response.ok) throw await asError(response);
  return (await response.json()) as T;
}

/** POST that answers with server-sent events: `reply` snapshots, then `result` or `error`. */
async function turn(body: TurnRequest, onReply: (text: string) => void, signal?: AbortSignal): Promise<TurnResult> {
  let response: Response;
  try {
    response = await fetch("/api/npc/turn", { method: "POST", headers: headers(true), body: JSON.stringify(body), signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "offline", "Couldn't reach the game server. Check your connection.");
  }
  if (!response.ok || !response.body) throw await asError(response);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1];
      if (!event || data === undefined) continue;
      const payload = JSON.parse(data) as Record<string, unknown>;
      if (event === "reply") onReply(String(payload.text ?? ""));
      else if (event === "result") return payload as unknown as TurnResult;
      else if (event === "error") throw new ApiError(Number(payload.status ?? 500), String(payload.error ?? "error"), String(payload.message ?? "Something went wrong."));
    }
    if (done) break;
  }
  throw new ApiError(502, "stream_ended", "The conversation stream ended unexpectedly. Try sending that again.");
}

export const api = {
  config: () => call<AppConfig>("/api/config"),
  search: (q: string, signal?: AbortSignal) => call<{ results: GeoResult[] }>(`/api/geo/search?q=${encodeURIComponent(q)}`, undefined, signal),
  expedition: (body: ExpeditionRequest, signal?: AbortSignal) => call<Expedition>("/api/expedition", body, signal),
  persona: (body: PersonaRequest, signal?: AbortSignal) => call<Persona>("/api/npc/persona", body, signal),
  turn,
  hint: (body: HintRequest) => call<Hint>("/api/coach/hint", body),
  debrief: (body: DebriefRequest) => call<Debrief>("/api/coach/debrief", body),
};
