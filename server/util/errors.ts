/** An error with an HTTP status and a message that is safe to show players. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** The model declined the request (stop_reason "refusal") even after fallbacks. */
export class AiRefusalError extends HttpError {
  constructor(category: string | null) {
    super(422, "ai_refusal", `The story engine declined that turn${category ? ` (${category})` : ""}. Try rephrasing.`);
  }
}

/** The model returned output we could not use (truncated or schema-invalid). */
export class AiOutputError extends HttpError {
  constructor(detail: string) {
    super(502, "ai_output", `The story engine returned something unexpected: ${detail}`);
  }
}
