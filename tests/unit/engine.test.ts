import { describe, expect, it } from "vitest";
import type { DebriefRequest } from "../../shared/schemas.ts";
import type { DebriefDraft, ExpeditionDraft, NpcTurnDraft, PersonaDraft } from "../../server/ai/schemas.ts";
import { finalizeDebrief, finalizeExpedition, finalizePersona, isVerbatim, normalizeQuiz, offsetPoint, resolveTurn } from "../../server/game/engine.ts";
import { buildNpcMessages } from "../../server/ai/prompts.ts";
import { context, npc, pack, persona, player, turnRequest } from "./fixtures.ts";

const draftTurn = (overrides: Partial<NpcTurnDraft> = {}): NpcTurnDraft => ({
  reply: "Selling mangoes, as always!",
  gesture: "laughs",
  emotion: "warm",
  rapport_delta: 6,
  perceived_moves: ["greeting", "open_question"],
  inner_thought: "A real question.",
  revealed_insight_ids: [],
  phrase: null,
  conversation_state: "ongoing",
  ...overrides,
});

describe("resolveTurn", () => {
  it("clamps the delta and applies it", () => {
    const result = resolveTurn(turnRequest(), draftTurn({ rapport_delta: 50 }), 1);
    expect(result.rapportDelta).toBe(12);
    expect(result.rapport).toBe(34);
  });

  it("gates insights the model reveals too early", () => {
    const early = resolveTurn(turnRequest(), draftTurn({ rapport_delta: 2, revealed_insight_ids: ["i1"] }), 1);
    expect(early.rapport).toBe(24);
    expect(early.revealedInsightIds).toEqual([]);
    const ready = resolveTurn(turnRequest({ rapport: 28 }), draftTurn({ rapport_delta: 4, revealed_insight_ids: ["i1", "i2"] }), 2);
    expect(ready.revealedInsightIds).toEqual(["i1"]);
  });

  it("drops unknown moves and invalid emotions", () => {
    const result = resolveTurn(turnRequest(), draftTurn({ perceived_moves: ["open_question", "made_up" as never], emotion: "ecstatic" as never }), 1);
    expect(result.moves).toEqual(["open_question"]);
    expect(result.emotion).toBe("neutral");
  });

  it("ends the encounter when rapport hits zero", () => {
    const result = resolveTurn(turnRequest({ rapport: 5 }), draftTurn({ rapport_delta: -15, perceived_moves: ["rude"] }), 3);
    expect(result).toMatchObject({ rapport: 0, ended: true, endReason: "walked_away" });
  });

  it("distinguishes a farewell from walking away", () => {
    expect(resolveTurn(turnRequest(), draftTurn({ conversation_state: "ended", perceived_moves: ["farewell"] }), 4).endReason).toBe("farewell");
    expect(resolveTurn(turnRequest({ rapport: 50 }), draftTurn({ conversation_state: "ended", rapport_delta: -10, perceived_moves: ["pushy"] }), 4).endReason).toBe("walked_away");
  });

  it("signals wrap-up and enforces the hard turn cap", () => {
    expect(resolveTurn(turnRequest(), draftTurn(), 12).wrapUp).toBe(true);
    expect(resolveTurn(turnRequest(), draftTurn(), 16)).toMatchObject({ ended: true, endReason: "turn_limit" });
  });
});

describe("finalizeExpedition", () => {
  const draft: ExpeditionDraft = {
    title: "Nairobi in the Rain",
    scene: "Drizzle on Moi Avenue.",
    locality: { city: "", region: "Nairobi County", country: "" },
    greeting: { language: "Swahili", phrase: "Habari", meaning: "What news?", pronunciation: "" },
    curiosity: ["Why matatus?", "Who sells here?", "What changed?", "extra"],
    notes: "Notes [W1].",
    npcs: [
      { name: "Wanjiru", age: 40, role: "fruit seller", place_source_id: "W1", place_name: "Moi Avenue", lens: "economy", scenario: "negotiate", difficulty: 9, hook: "h", goal: "g" },
      { name: "Otieno", age: 3, role: "guide", place_source_id: "P42", place_name: "Somewhere", lens: "history", scenario: "conversation", difficulty: 1, hook: "h", goal: "" },
    ],
  };

  it("maps places to coordinates, clamps values and fills gaps", () => {
    const exp = finalizeExpedition(draft, pack, { destination: { lat: -1.28, lng: 36.82, label: "Nairobi", source: "postcard" }, player }, "claude", 1000);
    expect(exp.npcs[0]).toMatchObject({ id: "npc-1", placeName: "Moi Avenue", placeSourceId: "W1", location: { lat: -1.283, lng: 36.824 }, difficulty: 3 });
    expect(exp.npcs[0]!.mapsUrl).toBeUndefined();
    expect(exp.npcs[1]).toMatchObject({ age: 16, placeSourceId: undefined, goal: "Get to know Otieno" });
    expect(exp.npcs[1]!.location).toEqual(offsetPoint(pack.center, 1));
    expect(exp.curiosity).toHaveLength(3);
    expect(exp.locality).toEqual({ city: "Nairobi", region: "Nairobi County", country: "Kenya" });
    expect(exp.sources).toEqual(pack.sources);
    expect(exp.greeting.pronunciation).toBeUndefined();
  });

  it("rejects an expedition with no locals", () => {
    expect(() => finalizeExpedition({ ...draft, npcs: [] }, pack, { destination: { lat: 0, lng: 0, label: "x", source: "pin" }, player }, "demo")).toThrow(/no locals/);
  });
});

describe("finalizePersona", () => {
  const draft: PersonaDraft = {
    pronouns: "",
    personality: "p",
    communication_style: "c",
    background: "b",
    current_situation: "s",
    hidden_concern: "h",
    boundaries: ["a", "b", "c", "d", "e"],
    language_notes: "l",
    scenario_brief: "sb",
    opening_line: "",
    opening_gesture: "g",
    insights: [
      { lens: "economy", title: "t1", fact: "f1", source_ids: ["W1", "bogus", "WX"], quiz: { question: "q", options: ["A", "B", "A", "C"], answer_index: 3 } },
      { lens: "culture", title: "t2", fact: "f2", source_ids: [], quiz: { question: "q", options: ["only"], answer_index: 7 } },
    ],
  };

  it("assigns ids, thresholds and starting rapport from the rules", () => {
    const result = finalizePersona(draft, npc);
    expect(result.insights.map((i) => [i.id, i.threshold])).toEqual([
      ["i1", 30],
      ["i2", 55],
    ]);
    expect(result.insights[0]!.sourceIds).toEqual(["W1", "WX"]);
    expect(result.startingRapport).toBe(22);
    expect(result.pronouns).toBe("they/them");
    expect(result.openingLine).toBe("Hello?");
    expect(result.boundaries).toHaveLength(4);
  });

  it("normalizes quizzes so the answer survives deduplication", () => {
    expect(normalizeQuiz({ question: "q", options: ["A", "B", "A", "C"], answer_index: 3 })).toEqual({ question: "q", options: ["A", "B", "C"], answerIndex: 2 });
    const tiny = normalizeQuiz({ question: "q", options: ["only"], answer_index: 7 });
    expect(tiny.options.length).toBeGreaterThanOrEqual(2);
    expect(tiny.options[tiny.answerIndex]).toBe("only");
  });
});

describe("finalizeDebrief", () => {
  const request: DebriefRequest = {
    ...turnRequest(),
    transcript: [
      { speaker: "npc", text: "Hello!", emotion: "curious", rapportDelta: 0, rapportAfter: 22, revealedInsightIds: [] },
      { speaker: "player", text: "What are you working on today?", moves: ["open_question"] },
      { speaker: "npc", text: "Mangoes.", emotion: "warm", rapportDelta: 5, rapportAfter: 27, revealedInsightIds: [] },
      { speaker: "player", text: "Do you like it here?", moves: ["closed_question"] },
    ],
    startRapport: 22,
    endReason: "farewell",
    selfRating: 3,
  };
  const draft: DebriefDraft = {
    headline: "A good start",
    summary: "s",
    scores: { curiosity: 7, listening: 2, empathy: null, respect: -1, clarity: 2.4, common_ground: null },
    evidence: [
      { skill: "curiosity", quote: "“What are you working on today?”", note: "open", positive: true },
      { skill: "listening", quote: "I hear you, that sounds tough", note: "invented", positive: true },
      { skill: "curiosity", quote: "do you LIKE it here", note: "case-insensitive excerpt", positive: false },
    ],
    strengths: ["a"],
    growth: { skill: "curiosity", tip: "t", original: "Do you like living here?", rewrite: "What do you like most about living here?" },
    calibration: "c",
    reflection_question: "r",
    field_mission: { title: "m", description: "d", skill: "curiosity" },
    goal_achieved: false,
    memory: "Sam asked about mangoes.",
  };

  it("keeps only evidence quoted verbatim from the learner", () => {
    const result = finalizeDebrief(draft, request);
    expect(result.evidence.map((e) => e.quote)).toEqual(["What are you working on today?", "do you LIKE it here"]);
  });

  it("clamps scores and repairs a paraphrased growth line", () => {
    const result = finalizeDebrief(draft, request);
    expect(result.scores).toEqual({ curiosity: 4, listening: 2, empathy: null, respect: 0, clarity: 2, common_ground: null });
    expect(result.growth.original).toBe("Do you like it here?");
  });

  it("matches quotes regardless of curly quotes and spacing", () => {
    expect(isVerbatim("  “what are   you working on”", ["What are you working on today?"])).toBe(true);
    expect(isVerbatim("hi", ["hi there"])).toBe(false);
  });
});

describe("buildNpcMessages", () => {
  it("is append-only across turns so the prompt cache prefix survives", () => {
    const first = turnRequest();
    const m1 = buildNpcMessages(first, 1);
    const second = turnRequest({
      transcript: [
        ...first.transcript,
        { speaker: "player", text: first.playerMessage, moves: ["greeting", "open_question"] },
        { speaker: "npc", text: "Selling mangoes!", emotion: "warm", rapportDelta: 6, rapportAfter: 28, innerThought: "Nice.", revealedInsightIds: [] },
      ],
      rapport: 28,
      playerMessage: "How long have you sold fruit here?",
    });
    const m2 = buildNpcMessages(second, 2);
    expect(m2.slice(0, m1.length)).toEqual(m1);
    expect(m2).toHaveLength(m1.length + 2);
    expect(m2[0]!.role).toBe("user");
    expect(m2.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
    expect(m2.at(-1)!.content).toContain('rapport_now="28"');
    expect(m2.at(-1)!.content).toContain("<player>How long have you sold fruit here?</player>");
    expect(JSON.parse(m2[3]!.content)).toMatchObject({ reply: "Selling mangoes!", rapport_delta: 6, perceived_moves: ["greeting", "open_question"] });
  });

  it("flags wrap-up from the soft turn cap", () => {
    expect(buildNpcMessages(turnRequest(), 12).at(-1)!.content).toContain('wrap_up="yes');
    expect(buildNpcMessages(turnRequest(), 3).at(-1)!.content).toContain('wrap_up="no"');
  });

  it("uses the persona's details in the opening scene", () => {
    expect(buildNpcMessages(turnRequest(), 1)[0]!.content).toContain(`${player.name} approaches you at ${persona.placeName}`);
    expect(context.title).toBeTruthy();
  });
});
