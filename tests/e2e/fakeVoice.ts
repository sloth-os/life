// A stand-in voice model for browser tests: an OpenAI-compatible server that "hears" any
// recording as the same line, streamed a few characters at a time (so the transcript shows before
// the notes on delivery), and that turns down audio output like the organization's omni model.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export const FAKE_HEARD = "Hello! It's my first time here. What do you enjoy most about your work?";

const LISTEN = { transcript: FAKE_HEARD, tone: "warm", pace: "natural", clarity: 88, note: "Warm and unhurried, with a friendly rise at the end." };
const PRONOUNCE = { transcript: "Habari", score: 84, tip: "Lovely! Give the second syllable a little more weight: ha-BA-ri." };

const event = (delta: { content?: string }, finish: string | null = null) =>
  `data: ${JSON.stringify({ id: "fake", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

export async function startFakeVoiceModel(port = 0): Promise<{ url: string; close: () => void }> {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => (raw += chunk.toString()));
    req.on("end", () => {
      if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
        res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "not found" } }));
        return;
      }
      const body = JSON.parse(raw || "{}") as { modalities?: string[]; messages?: { role: string; content: unknown }[] };
      if (body.modalities?.includes("audio")) {
        res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "This model does not support the modalities parameter containing audio" } }));
        return;
      }
      const system = String(body.messages?.find((m) => m.role === "system")?.content ?? "");
      const answer = JSON.stringify(/pronunciation/i.test(system) ? PRONOUNCE : LISTEN);
      const pieces: string[] = [];
      for (let i = 0; i < answer.length; i += 12) pieces.push(answer.slice(i, i + 12));
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      // A few characters at a time, as a real model streams.
      let i = 0;
      const timer = setInterval(() => {
        if (i < pieces.length) {
          res.write(event({ content: pieces[i++]! }));
          return;
        }
        clearInterval(timer);
        res.end(`${event({}, "stop")}data: [DONE]\n\n`);
      }, 15);
    });
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const { port: actual } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${actual}/v1`, close: () => server.close() };
}
