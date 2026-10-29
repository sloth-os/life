/**
 * Decode the (possibly still-streaming) string value of `key` from partial
 * JSON text. Returns null until the key appears. Used to show an NPC's reply
 * while the rest of the structured turn is still being generated.
 */
export function extractPartialString(json: string, key: string): string | null {
  const match = new RegExp(`"${key}"\\s*:\\s*"`).exec(json);
  if (!match) return null;
  const escapes: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", '"': '"', "\\": "\\", "/": "/" };
  let out = "";
  let i = match.index + match[0].length;
  while (i < json.length) {
    const ch = json[i]!;
    if (ch === '"') return out;
    if (ch === "\\") {
      const next = json[i + 1];
      if (next === undefined) break;
      if (next === "u") {
        const hex = json.slice(i + 2, i + 6);
        if (hex.length < 4) break;
        out += String.fromCharCode(Number.parseInt(hex, 16));
        i += 6;
        continue;
      }
      out += escapes[next] ?? next;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Index of the quote closing the JSON string that opens at `start`, or -1 while it is unfinished. */
function stringEnd(json: string, start: number): number {
  for (let i = start + 1; i < json.length; i++) {
    if (json[i] === "\\") i++;
    else if (json[i] === '"') return i;
  }
  return -1;
}

/** Index just past the JSON value that starts at `start`, or -1 while it is unfinished. */
function valueEnd(json: string, start: number): number {
  const first = json[start];
  if (first === '"') {
    const end = stringEnd(json, start);
    return end === -1 ? -1 : end + 1;
  }
  if (first === "{" || first === "[") {
    let depth = 0;
    for (let i = start; i < json.length; i++) {
      const ch = json[i];
      if (ch === '"') {
        i = stringEnd(json, i);
        if (i === -1) return -1;
      } else if (ch === "{" || ch === "[") depth++;
      else if (ch === "}" || ch === "]") {
        depth--;
        if (depth === 0) return i + 1;
      }
    }
    return -1;
  }
  // A number or literal is complete only once something follows it ("12" may become "123").
  const match = /^[^,}\]\s]+(?=[,}\]\s])/.exec(json.slice(start));
  return match ? start + match[0].length : -1;
}

/**
 * The top-level fields of a (possibly still-streaming) JSON object whose values are
 * complete, parsed. Lets the engine show an expedition's briefing while the locals
 * that follow it in the same answer are still being written.
 */
export function parsePartialObject(json: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let i = json.indexOf("{");
  if (i === -1) return out;
  i++;
  const skip = (pattern: RegExp) => {
    while (i < json.length && pattern.test(json[i]!)) i++;
  };
  for (;;) {
    skip(/[\s,]/);
    if (json[i] !== '"') return out;
    const keyEnd = stringEnd(json, i);
    if (keyEnd === -1) return out;
    const key = JSON.parse(json.slice(i, keyEnd + 1)) as string;
    i = keyEnd + 1;
    skip(/\s/);
    if (json[i] !== ":") return out;
    i++;
    skip(/\s/);
    const end = valueEnd(json, i);
    if (end === -1) return out;
    try {
      out[key] = JSON.parse(json.slice(i, end));
    } catch {
      return out;
    }
    i = end;
  }
}
