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
