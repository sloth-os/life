import { describe, expect, it } from "vitest";
import { DemoGameAI, buildQuiz, demoDelta, detectMoves } from "../../server/ai/demo.ts";
import { context, npc, pack, player, turnRequest } from "./fixtures.ts";

const moves = (text: string, lastNpcText = "I sell mangoes and avocados here every day.") => detectMoves(text, { lastNpcText, greeting: "Habari", firstTurn: false });

describe("detectMoves", () => {
  it("recognizes open and closed questions", () => {
    expect(moves("What's a normal day like for you?")).toContain("open_question");
    expect(moves("Do you like it here?")).toContain("closed_question");
    expect(moves("Tell me about the market.")).toContain("open_question");
  });

  it("recognizes follow-ups, reflections and empathy", () => {
    expect(moves("How long have you been selling mangoes?")).toContain("follow_up");
    expect(moves("So it sounds like the market is your second home.")).toContain("reflection");
    expect(moves("That must be exhausting.")).toContain("empathy");
  });

  it("flags assumptions, rudeness and pushiness", () => {
    expect(moves("You people must all be poor here")).toContain("assumption");
    expect(moves("This place is so exotic!")).toContain("assumption");
    expect(moves("whatever, that's boring")).toContain("rude");
    expect(moves("Just tell me the last price, come on")).toContain("pushy");
  });

  it("recognizes greetings in the local language and farewells", () => {
    expect(detectMoves("Habari! Nice to meet you", { firstTurn: true, greeting: "Habari" })).toContain("greeting");
    expect(moves("Thanks so much, take care!")).toEqual(expect.arrayContaining(["gratitude", "farewell"]));
  });

  it("notices minimal replies to a question", () => {
    expect(moves("ok", "What brings you here?")).toEqual(["ignoring"]);
  });
});

describe("demoDelta", () => {
  it("rewards good moves and punishes bad ones", () => {
    expect(demoDelta(["open_question", "follow_up"], 2, false)).toBe(9);
    expect(demoDelta(["assumption"], 2, false)).toBe(-8);
    expect(demoDelta(["rude", "assumption"], 1, false)).toBe(-15);
  });

  it("is harder to win over guarded locals", () => {
    expect(demoDelta(["reflection", "empathy"], 3, false)).toBeLessThan(demoDelta(["reflection", "empathy"], 1, false));
  });
});

describe("buildQuiz", () => {
  it("builds a cloze question around a number with distinct distractors", () => {
    const quiz = buildQuiz("The mosque was built between 1925 and 1933 by the community.", ["Nairobi is the capital of Kenya."], 7);
    expect(quiz.question).toContain("_____");
    expect(quiz.options[quiz.answer_index]).toBe("1925");
    expect(new Set(quiz.options).size).toBe(quiz.options.length);
  });

  it("falls back to a recognition question", () => {
    const quiz = buildQuiz("lowercase only words here with nothing to blank.", [], 1);
    expect(quiz.options[quiz.answer_index]).toContain("lowercase only words");
  });
});

describe("DemoGameAI", () => {
  const ai = new DemoGameAI({ typingDelayMs: 0 });

  it("composes a grounded expedition with three distinct locals", async () => {
    const draft = await ai.composeExpedition({ destination: { lat: -1.2841, lng: 36.8235, label: "Nairobi", postcardId: "nairobi", source: "postcard" }, pack, player, suggestedDifficulty: 1 });
    expect(draft.npcs).toHaveLength(3);
    expect(new Set(draft.npcs.map((n) => n.lens)).size).toBe(3);
    expect(draft.npcs[0]!.place_source_id).toBe("W1");
    expect(draft.greeting.phrase).toBe("Habari");
    expect(draft.notes).toContain("[W0]");
  });

  it("creates personas whose insights quote the sources", async () => {
    const draft = await ai.createPersona({ request: { context, npc, player } });
    expect(draft.insights).toHaveLength(3);
    for (const insight of draft.insights) expect(insight.quiz.answer_index).toBeLessThan(insight.quiz.options.length);
    expect(draft.insights.some((i) => i.source_ids.length > 0)).toBe(true);
  });

  it("streams replies and reacts to stereotyping", async () => {
    const snapshots: string[] = [];
    const turn = await ai.npcTurn({ request: turnRequest({ playerMessage: "You people must all be poor here" }), turnNumber: 2, wrapUp: false }, (s) => snapshots.push(s));
    expect(turn.perceived_moves).toContain("assumption");
    expect(turn.rapport_delta).toBeLessThan(0);
    expect(turn.emotion).toBe("annoyed");
    expect(snapshots.at(-1)).toBe(turn.reply);
    expect(snapshots.length).toBeGreaterThan(1);
  });
});
