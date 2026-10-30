import type { Assignment, AssignmentInput, ClassDashboard, ClassResultInput, CreateClassRequest, JoinClassRequest, StudentClassView } from "../../shared/classroom.ts";
import type {
  ApiErrorBody,
  AskRequest,
  AppConfig,
  Debrief,
  DebriefRequest,
  Expedition,
  ExpeditionBriefing,
  ExpeditionRequest,
  GeoResult,
  Heard,
  Hint,
  HintRequest,
  ListenRequest,
  MediationDebriefRequest,
  MediationScene,
  MediationSceneRequest,
  MediationTurnRequest,
  MediationTurnResult,
  MentorAnswer,
  PostcardRequest,
  PronounceRequest,
  PronunciationResult,
  SpeakRequest,
  Persona,
  PersonaRequest,
  StreamProgress,
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

/** Called when the server turns the access code down (it was set or changed while playing). */
let onAccessRejected: () => void = () => {};
export function whenAccessRejected(handler: () => void): void {
  onAccessRejected = handler;
}

/** crypto.randomUUID only exists in secure contexts; a classroom server on plain http://<LAN IP> isn't one. */
function randomId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A random per-browser id, so rate limits apply per player rather than per shared school IP. */
const clientId = (() => {
  try {
    const existing = localStorage.getItem("common-ground:client");
    if (existing) return existing;
    const id = randomId();
    localStorage.setItem("common-ground:client", id);
    return id;
  } catch {
    return randomId();
  }
})();

function headers(json: boolean): HeadersInit {
  const h: Record<string, string> = { "X-Client-Id": clientId };
  if (json) h["Content-Type"] = "application/json";
  if (accessCode) h["X-Access-Code"] = accessCode;
  return h;
}

export async function asError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    if (response.status === 401 && body.error === "access_code") onAccessRejected();
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

/** Any method, with extra headers (the teacher's key), answering JSON or nothing. */
export async function send<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { method, headers: { ...headers(body !== undefined), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, "offline", "Couldn't reach the game server. Check your connection.");
  }
  if (!response.ok) throw await asError(response);
  return (response.status === 204 ? undefined : await response.json()) as T;
}

const teacher = (key: string) => ({ "X-Teacher-Key": key });
const classPath = (code: string, rest = "") => `/api/classes/${encodeURIComponent(code)}${rest}`;

/** POST that answers with bytes (speech, images). */
async function binary(path: string, body: unknown, signal?: AbortSignal): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(path, { method: "POST", headers: headers(true), body: JSON.stringify(body), signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "offline", "Couldn't reach the game server. Check your connection.");
  }
  if (!response.ok) throw await asError(response);
  return response.blob();
}

/** Handlers for the events a streamed call sends before its `result`. */
export interface StreamHandlers {
  signal?: AbortSignal;
  onProgress?: (progress: StreamProgress) => void;
  onBriefing?: (briefing: ExpeditionBriefing) => void;
  /** Text written so far: the local's reply, the mentor's answer, or the words the voice model heard. */
  onText?: (text: string) => void;
}

/**
 * POST that answers with server-sent events (`progress`, `briefing`, `reply`/`answer`
 * snapshots), then `result` or `error`. Long calls stream so the player sees real progress
 * and proxies see a live connection.
 */
async function stream<T>(path: string, body: unknown, handlers: StreamHandlers = {}, endedMessage = "The connection ended unexpectedly. Try again."): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { method: "POST", headers: { ...headers(true), Accept: "text/event-stream" }, body: JSON.stringify(body), signal: handlers.signal });
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
      if (event === "result") return payload as T;
      if (event === "error") throw new ApiError(Number(payload.status ?? 500), String(payload.error ?? "error"), String(payload.message ?? "Something went wrong."));
      if (event === "progress") handlers.onProgress?.(payload as unknown as StreamProgress);
      else if (event === "briefing") handlers.onBriefing?.(payload as unknown as ExpeditionBriefing);
      else if (event === "reply" || event === "answer" || event === "transcript") handlers.onText?.(String(payload.text ?? ""));
    }
    if (done) break;
  }
  throw new ApiError(502, "stream_ended", endedMessage);
}

function turn(body: TurnRequest, onReply: (text: string) => void, signal?: AbortSignal): Promise<TurnResult> {
  return stream<TurnResult>("/api/npc/turn", body, { signal, onText: onReply }, "The conversation stream ended unexpectedly. Try sending that again.");
}

export const api = {
  config: () => call<AppConfig>("/api/config"),
  search: (q: string, signal?: AbortSignal) => call<{ results: GeoResult[] }>(`/api/geo/search?q=${encodeURIComponent(q)}`, undefined, signal),
  expedition: (body: ExpeditionRequest, handlers?: StreamHandlers) => stream<Expedition>("/api/expedition", body, handlers),
  persona: (body: PersonaRequest, handlers?: StreamHandlers) => stream<Persona>("/api/npc/persona", body, handlers),
  turn,
  hint: (body: HintRequest) => call<Hint>("/api/coach/hint", body),
  debrief: (body: DebriefRequest, handlers?: StreamHandlers) => stream<Debrief>("/api/coach/debrief", body, handlers),
  mediationScene: (body: MediationSceneRequest, handlers?: StreamHandlers) => stream<MediationScene>("/api/mediation/scene", body, handlers),
  mediationTurn: (body: MediationTurnRequest, onReply: (text: string) => void, signal?: AbortSignal) =>
    stream<MediationTurnResult>("/api/mediation/turn", body, { signal, onText: onReply }, "The conversation stream ended unexpectedly. Try sending that again."),
  mediationDebrief: (body: MediationDebriefRequest, handlers?: StreamHandlers) => stream<Debrief>("/api/mediation/debrief", body, handlers),
  ask: (body: AskRequest, onAnswer: (text: string) => void) => stream<MentorAnswer>("/api/coach/ask", body, { onText: onAnswer }, "Your mentor's answer was cut off. Try asking again."),
  speak: (body: SpeakRequest, signal?: AbortSignal) => binary("/api/voice/speak", body, signal),
  /** What the player said (`onWords` gets it as the model writes it), then how it sounded. */
  listen: (body: ListenRequest, onWords?: (text: string) => void) => stream<Heard>("/api/voice/listen", body, { onText: onWords }),
  pronounce: (body: PronounceRequest) => call<PronunciationResult>("/api/voice/pronounce", body),
  postcard: (body: PostcardRequest) => binary("/api/postcard", body),
  classes: {
    create: (body: CreateClassRequest) => send<{ code: string; teacherKey: string }>("POST", "/api/classes", body),
    view: (code: string) => send<StudentClassView>("GET", classPath(code)),
    join: (code: string, body: JoinClassRequest) => send<{ studentId: string; view: StudentClassView }>("POST", classPath(code, "/join"), body),
    submit: (code: string, body: ClassResultInput) => send<void>("POST", classPath(code, "/results"), body),
    dashboard: (code: string, key: string) => send<ClassDashboard>("GET", classPath(code, "/dashboard"), undefined, teacher(key)),
    assign: (code: string, key: string, body: AssignmentInput) => send<Assignment>("POST", classPath(code, "/assignments"), body, teacher(key)),
    unassign: (code: string, key: string, id: string) => send<void>("DELETE", classPath(code, `/assignments/${encodeURIComponent(id)}`), undefined, teacher(key)),
  },
};
