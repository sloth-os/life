// Mediation scenes: the engine stays authoritative over tension, trust and how it ends.
import { describe, expect, it } from "vitest";
import { AGREEMENT_TENSION_MAX, MEDIATION_STARTING_RAPPORT, WALKOUT_TENSION } from "../../shared/rules.ts";
import type { MediationScene, MediationTurnRequest } from "../../shared/schemas.ts";
import { DemoGameAI } from "../../server/ai/demo.ts";
import { buildMediationMessages, renderMediationDebriefInput } from "../../server/ai/mediationPrompts.ts";
import type { MediationTurnDraft } from "../../server/ai/schemas.ts";
import { finalizeScene, resolveMediationTurn } from "../../server/game/mediation.ts";
import { context, player } from "./fixtures.ts";

const ai = new DemoGameAI({ typingDelayMs: 0 });

async function scene(): Promise<MediationScene> {
  return finalizeScene(await ai.createScene({ context, player }), { context, player });
}

const draft = (patch: Partial<MediationTurnDraft> = {}): MediationTurnDraft => ({
  replies: [{ speaker: "a", text: "Fine, fine.", gesture: "sighs", emotion: "warm" }],
  perceived_moves: ["reflection", "made_up" as never],
  tension_delta: -8,
  rapport_a_delta: 6,
  rapport_b_delta: 4,
  inner_thought_a: "She gets it.",
  inner_thought_b: "Fair enough.",
  state: "ongoing",
  agreement: "",
  ...patch,
});

const request = (s: MediationScene, patch: Partial<MediationTurnRequest> = {}): MediationTurnRequest => ({
  context,
  scene: s,
  player,
  transcript: [],
  tension: s.startTension,
  rapport: { a: MEDIATION_STARTING_RAPPORT, b: MEDIATION_STARTING_RAPPORT },
  playerMessage: "What matters most to each of you?",
  ...patch,
});

describe("mediation", () => {
  it("sets up a scene with two distinct parties and a hidden shared interest", async () => {
    const s = await scene();
    expect(s.parties.map((p) => p.id)).toEqual(["a", "b"]);
    expect(s.parties[0].name).not.toBe(s.parties[1].name);
    expect(s.sharedInterest).not.toBe("");
    expect(s.opening.length).toBeGreaterThan(0);
    expect(s.startTension).toBeGreaterThanOrEqual(40);
  });

  it("clamps the model's numbers and keeps each party's private reaction", async () => {
    const s = await scene();
    const result = resolveMediationTurn(request(s), draft({ tension_delta: -60, rapport_a_delta: 40 }), 1);
    expect(result.tensionDelta).toBe(-15);
    expect(result.rapport.a).toBe(MEDIATION_STARTING_RAPPORT + 12);
    expect(result.moves).toEqual(["reflection"]);
    expect(result.reactions).toEqual({ a: { thought: "She gets it.", rapportDelta: 12 }, b: { thought: "Fair enough.", rapportDelta: 4 } });
    expect(result.ended).toBe(false);
  });

  it("accepts an agreement only once tension is down and both trust the learner", async () => {
    const s = await scene();
    const tooHot = resolveMediationTurn(request(s, { tension: 80 }), draft({ state: "agreement", agreement: "Share it." }), 3);
    expect(tooHot.ended).toBe(false);
    const distrust = resolveMediationTurn(request(s, { tension: 40, rapport: { a: 70, b: 20 } }), draft({ state: "agreement", rapport_b_delta: 0 }), 3);
    expect(distrust.ended).toBe(false);
    const settled = resolveMediationTurn(request(s, { tension: AGREEMENT_TENSION_MAX + 5 }), draft({ state: "agreement", agreement: "One awning, shared cost." }), 3);
    expect(settled).toMatchObject({ ended: true, endReason: "agreement", agreement: "One awning, shared cost." });
  });

  it("ends when someone walks off, however the model labels it", async () => {
    const s = await scene();
    expect(resolveMediationTurn(request(s, { tension: WALKOUT_TENSION - 5 }), draft({ tension_delta: 12 }), 2)).toMatchObject({ ended: true, endReason: "walked_away" });
    expect(resolveMediationTurn(request(s), draft({ state: "walked_away" }), 2).endReason).toBe("walked_away");
  });

  it("plays out in Demo AI: listening cools it, a fair proposal settles it", async () => {
    const s = await scene();
    let tension = s.startTension;
    let rapport = { a: MEDIATION_STARTING_RAPPORT, b: MEDIATION_STARTING_RAPPORT };
    const lines = [
      "I can hear you're both frustrated. What matters most to each of you here?",
      "So it sounds like you both want this street to work. That makes sense — it's hard when it feels unfair.",
      "Thank you both for explaining. What if you could both keep what matters most to you?",
      "How about you share it and take turns, so it works for both of you?",
    ];
    let ended = false;
    for (const [i, line] of lines.entries()) {
      const req = request(s, { tension, rapport, playerMessage: line });
      const result = resolveMediationTurn(req, await ai.mediationTurn({ request: req, turnNumber: i + 1, wrapUp: false }), i + 1);
      tension = result.tension;
      rapport = result.rapport;
      if (result.ended) {
        expect(result.endReason).toBe("agreement");
        ended = true;
        break;
      }
    }
    expect(ended).toBe(true);
    expect(tension).toBeLessThan(s.startTension);

    const taking = request(s, { playerMessage: "You're wrong. Be reasonable and just move." });
    const heated = resolveMediationTurn(taking, await ai.mediationTurn({ request: taking, turnNumber: 1, wrapUp: false }), 1);
    expect(heated.tension).toBeGreaterThan(s.startTension);
  });

  it("gives the model the conversation, the state of play and both reactions for the mentor", async () => {
    const s = await scene();
    const req = request(s, {
      transcript: [
        { speaker: "player", text: "What matters to you?", moves: ["open_question"], reactions: { a: { thought: "Finally someone asks.", rapportDelta: 6 }, b: { thought: "Hm.", rapportDelta: 1 } } },
        { speaker: "party", who: "a", text: "My stock spoils.", emotion: "guarded" },
      ],
      tension: 61,
    });
    const [message] = buildMediationMessages(req, 2, false);
    expect(message!.content).toContain("<player>What matters to you?</player>");
    expect(message!.content).toContain("tension 61/100");
    const mentor = renderMediationDebriefInput({ ...req, endReason: "turn_limit", selfRating: 3 });
    expect(mentor).toContain('VISITOR #1: "What matters to you?"');
    expect(mentor).toContain("Finally someone asks.");
    expect(mentor).toContain(`shared interest: ${s.sharedInterest}`);
  });
});
