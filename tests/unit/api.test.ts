// End-to-end over HTTP: the real Express app, game engine and Demo AI, with
// grounding served by a fake network.
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig, Debrief, Expedition, Hint, Persona, TranscriptEntry, TurnResult } from "../../shared/schemas.ts";
import { DemoGameAI } from "../../server/ai/demo.ts";
import { createApp } from "../../server/app.ts";
import { loadConfig, type ServerConfig } from "../../server/config.ts";
import { GameEngine } from "../../server/game/engine.ts";
import { GroundingService } from "../../server/grounding/index.ts";
import { fakeOpenDataFetch } from "./openDataFetch.ts";
import { player } from "./fixtures.ts";

const servers: ReturnType<ReturnType<typeof createApp>["listen"]>[] = [];

async function start(overrides: Partial<ServerConfig> = {}): Promise<string> {
  const config = { ...loadConfig({}, []), ...overrides };
  const grounding = new GroundingService({ config, fetchImpl: fakeOpenDataFetch(), log: () => {} });
  const engine = new GameEngine({ ai: new DemoGameAI({ typingDelayMs: 0 }), grounding });
  const app = createApp({ config, engine, grounding, log: () => {} });
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
}

afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

async function sseEvents(response: Response): Promise<{ event: string; data: Record<string, unknown> }[]> {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((block) => ({ event: /^event: (.+)$/m.exec(block)![1]!, data: JSON.parse(/^data: (.*)$/m.exec(block)![1]!) as Record<string, unknown> }));
}

const destination = { lat: -1.2841, lng: 36.8235, label: "Nairobi", country: "Kenya", postcardId: "nairobi", source: "postcard" as const };

describe("API", () => {
  it("serves client config without secrets", async () => {
    const api = await start();
    const config = (await (await fetch(`${api}/config`)).json()) as AppConfig;
    expect(config).toMatchObject({ mapsMode: "open", aiMode: "demo", placeGrounding: "wikipedia", accessCodeRequired: false });
    expect(config.googleMapsApiKey).toBeUndefined();
  });

  it("streams progress, the briefing and then the expedition when asked for events", async () => {
    const api = await start();
    const response = await post(`${api}/expedition`, { destination, player }, { accept: "text/event-stream" });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const events = await sseEvents(response);
    const names = events.map((e) => e.event);
    expect(names[0]).toBe("progress");
    expect(events[0]!.data).toMatchObject({ phase: "grounding" });
    expect(names.indexOf("briefing")).toBeLessThan(names.indexOf("result"));
    const briefing = events.find((e) => e.event === "briefing")!.data as { title: string; greeting: { phrase: string } };
    const expedition = events.at(-1)!.data as unknown as Expedition;
    expect(names.at(-1)).toBe("result");
    expect(briefing.title).toBe(expedition.title);
    expect(briefing.greeting.phrase).toBe(expedition.greeting.phrase);
    expect(expedition.npcs).toHaveLength(3);

    const persona = await post(`${api}/npc/persona`, { context: { expeditionId: expedition.id, title: expedition.title, destinationLabel: "Nairobi", locality: expedition.locality, scene: expedition.scene, greeting: expedition.greeting, notes: expedition.notes, sources: [] }, npc: expedition.npcs[0], player }, { accept: "text/event-stream" });
    expect((await sseEvents(persona)).at(-1)).toMatchObject({ event: "result", data: { npcId: "npc-1" } });
  });

  it("validates requests", async () => {
    const api = await start();
    const bad = await post(`${api}/expedition`, { destination: { lat: 999 }, player });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: "invalid_request" });
    const malformed = await fetch(`${api}/expedition`, { method: "POST", headers: { "content-type": "application/json" }, body: "{nope" });
    expect(malformed.status).toBe(400);
    expect((await fetch(`${api}/nope`)).status).toBe(404);
  });

  it("plays a whole encounter: expedition → persona → streamed turns → hint → debrief", async () => {
    const api = await start();
    const expedition = (await (await post(`${api}/expedition`, { destination, player })).json()) as Expedition;
    expect(expedition.npcs).toHaveLength(3);
    expect(expedition.sources.length).toBeGreaterThan(0);
    const npc = expedition.npcs[0]!;
    const context = {
      expeditionId: expedition.id,
      title: expedition.title,
      destinationLabel: expedition.destination.label,
      locality: expedition.locality,
      scene: expedition.scene,
      weatherSummary: expedition.weather?.summary,
      greeting: expedition.greeting,
      notes: expedition.notes,
      sources: expedition.sources.map((s) => ({ id: s.id, title: s.title, kind: s.kind })),
    };

    const persona = (await (await post(`${api}/npc/persona`, { context, npc, player })).json()) as Persona;
    expect(persona.insights.map((i) => i.threshold)).toEqual([30, 55, 75]);

    const transcript: TranscriptEntry[] = [{ speaker: "npc", text: persona.openingLine, emotion: "curious", rapportDelta: 0, rapportAfter: persona.startingRapport, revealedInsightIds: [] }];
    let rapport = persona.startingRapport;
    const unlocked: string[] = [];
    for (const line of ["Habari! What are you working on today?", "So you've been here for years — what has changed the most?", "That sounds hard. How are you holding up?"]) {
      const response = await post(`${api}/npc/turn`, { context, npc, persona, player, transcript, rapport, unlockedInsightIds: unlocked, playerMessage: line });
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      const events = await sseEvents(response);
      const replies = events.filter((e) => e.event === "reply");
      const result = events.find((e) => e.event === "result")!.data as unknown as TurnResult;
      expect(replies.length).toBeGreaterThan(1);
      expect(replies.at(-1)!.data.text).toBe(result.reply);
      expect(result.rapport).toBeGreaterThan(rapport);
      transcript.push({ speaker: "player", text: line, moves: result.moves });
      transcript.push({ speaker: "npc", text: result.reply, emotion: result.emotion, rapportDelta: result.rapportDelta, rapportAfter: result.rapport, innerThought: result.innerThought, revealedInsightIds: result.revealedInsightIds });
      rapport = result.rapport;
      unlocked.push(...result.revealedInsightIds);
    }
    expect(unlocked.length).toBeGreaterThan(0);

    const hint = (await (await post(`${api}/coach/hint`, { context, npc, persona, player, transcript, rapport, unlockedInsightIds: unlocked })).json()) as Hint;
    expect(hint.suggestion.length).toBeGreaterThan(10);

    const debrief = (await (
      await post(`${api}/coach/debrief`, { context, npc, persona, player, transcript, rapport, unlockedInsightIds: unlocked, startRapport: persona.startingRapport, endReason: "farewell", selfRating: 3 })
    ).json()) as Debrief;
    expect(debrief.scores.curiosity).toBeGreaterThan(0);
    const playerLines = transcript.filter((e) => e.speaker === "player").map((e) => e.text);
    for (const e of debrief.evidence) expect(playerLines.some((line) => line.includes(e.quote))).toBe(true);
    expect(debrief.fieldMission.title).toBeTruthy();
  });

  it("refuses turns once the conversation is over (as an SSE error)", async () => {
    const api = await start();
    const expedition = (await (await post(`${api}/expedition`, { destination, player })).json()) as Expedition;
    const npc = expedition.npcs[0]!;
    const context = { expeditionId: expedition.id, title: "t", destinationLabel: "Nairobi", locality: {}, scene: "s", greeting: expedition.greeting, notes: expedition.notes, sources: [] };
    const persona = (await (await post(`${api}/npc/persona`, { context, npc, player })).json()) as Persona;
    const transcript: TranscriptEntry[] = [];
    for (let i = 0; i < 16; i++) {
      transcript.push({ speaker: "player", text: `line ${i}` });
      transcript.push({ speaker: "npc", text: "mm", emotion: "neutral", rapportDelta: 0, rapportAfter: 20, revealedInsightIds: [] });
    }
    const events = await sseEvents(await post(`${api}/npc/turn`, { context, npc, persona, player, transcript, rapport: 20, unlockedInsightIds: [], playerMessage: "one more?" }));
    expect(events.at(-1)).toMatchObject({ event: "error", data: { error: "encounter_over", status: 409 } });
  });

  it("enforces the access code on game routes", async () => {
    const api = await start({ accessCode: "class-7b" });
    expect(((await (await fetch(`${api}/config`)).json()) as AppConfig).accessCodeRequired).toBe(true);
    expect((await post(`${api}/expedition`, { destination, player })).status).toBe(401);
    expect((await post(`${api}/expedition`, { destination, player }, { "x-access-code": "class-7b" })).status).toBe(200);
  });

  it("rate-limits AI routes per client", async () => {
    const api = await start({ rateLimitPer10Min: 2 });
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await fetch(`${api}/geo/search?q=Lisbon`)).status);
    expect(statuses).toEqual([200, 200, 429]);
  });

  it("limits players sharing an IP separately", async () => {
    const api = await start({ rateLimitPer10Min: 1 });
    const as = (id: string) => fetch(`${api}/geo/search?q=Lisbon`, { headers: { "x-client-id": id } }).then((r) => r.status);
    expect([await as("student-1"), await as("student-1"), await as("student-2")]).toEqual([200, 429, 200]);
  });
});
