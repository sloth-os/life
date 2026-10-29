// Mediation scenes: the model sets up and plays two locals at odds; the engine stays authoritative
// over tension, each party's trust, and how it ends. A model that declares a settlement while the
// two are still heated, or before both trust the learner, doesn't get its way.
import { randomBytes } from "node:crypto";
import {
  AGREEMENT_RAPPORT_MIN,
  AGREEMENT_TENSION_MAX,
  MEDIATION_TURN_HARD_CAP,
  MEDIATION_TURN_SOFT_CAP,
  TENSION_DELTA_MAX,
  TENSION_DELTA_MIN,
  WALKOUT_TENSION,
  applyRapport,
  clamp,
  clampDelta,
} from "../../shared/rules.ts";
import type { MediationScene, MediationSceneRequest, MediationTurnRequest, MediationTurnResult, Party, PartyId } from "../../shared/schemas.ts";
import { isEmotionId, isMoveId } from "../../shared/world.ts";
import { hashString } from "../ai/demo.ts";
import type { MediationTurnDraft, SceneDraft } from "../ai/schemas.ts";
import { AiOutputError } from "../util/errors.ts";

const trim = (value: string | undefined | null, max: number): string => (value ?? "").trim().slice(0, max);

export function finalizeScene(draft: SceneDraft, request: MediationSceneRequest, now = Date.now()): MediationScene {
  const party = (d: SceneDraft["party_a"], id: PartyId, fallback: string): Party => {
    const name = trim(d.name, 60) || fallback;
    return {
      id,
      name,
      age: clamp(Math.round(d.age || 35), 16, 95),
      role: trim(d.role, 80) || "local resident",
      pronouns: trim(d.pronouns, 30) || "they/them",
      position: trim(d.position, 300),
      interest: trim(d.interest, 300),
      temperament: trim(d.temperament, 200),
      hue: hashString(name) % 360,
    };
  };
  const a = party(draft.party_a, "a", "Amira");
  const b = party(draft.party_b, "b", "Jonas");
  if (!a.position || !b.position) throw new AiOutputError("the scene has no disagreement");
  const opening = draft.opening
    .slice(0, 3)
    .map((line) => ({ who: (line.speaker === "b" ? "b" : "a") as PartyId, text: trim(line.text, 400), gesture: trim(line.gesture, 160) }))
    .filter((line) => line.text);
  if (opening.length === 0) opening.push({ who: "a", text: a.position, gesture: "" });
  const place = trim(draft.place_name, 120) || request.context.destinationLabel;
  return {
    id: `med_${now.toString(36)}_${randomBytes(3).toString("hex")}`,
    title: trim(draft.title, 120) || `Trouble at ${place}`,
    placeName: place,
    situation: trim(draft.situation, 600),
    topic: trim(draft.topic, 160),
    parties: [a, b],
    sharedInterest: trim(draft.shared_interest, 300),
    goal: trim(draft.goal, 200) || `Help ${a.name} and ${b.name} find an arrangement they can both live with`,
    opening,
    startTension: clamp(Math.round(draft.start_tension || 65), 40, 85),
  };
}

export function resolveMediationTurn(request: MediationTurnRequest, draft: MediationTurnDraft, turnNumber: number): MediationTurnResult {
  const tensionDelta = Number.isFinite(draft.tension_delta) ? clamp(Math.round(draft.tension_delta), TENSION_DELTA_MIN, TENSION_DELTA_MAX) : 0;
  const tension = clamp(request.tension + tensionDelta, 0, 100);
  const deltas = { a: clampDelta(draft.rapport_a_delta), b: clampDelta(draft.rapport_b_delta) };
  const rapport = { a: applyRapport(request.rapport.a, deltas.a), b: applyRapport(request.rapport.b, deltas.b) };
  const replies = draft.replies
    .slice(0, 2)
    .map((r) => ({ who: (r.speaker === "b" ? "b" : "a") as PartyId, text: trim(r.text, 800), gesture: trim(r.gesture, 200), emotion: isEmotionId(r.emotion) ? r.emotion : "neutral" }))
    .filter((r) => r.text);
  if (replies.length === 0) throw new AiOutputError("nobody answered");

  let endReason: MediationTurnResult["endReason"];
  if (draft.state === "agreement" && tension <= AGREEMENT_TENSION_MAX && rapport.a >= AGREEMENT_RAPPORT_MIN && rapport.b >= AGREEMENT_RAPPORT_MIN) endReason = "agreement";
  else if (draft.state === "walked_away" || tension >= WALKOUT_TENSION) endReason = "walked_away";
  else if (turnNumber >= MEDIATION_TURN_HARD_CAP) endReason = "turn_limit";

  return {
    replies,
    reactions: {
      a: { thought: trim(draft.inner_thought_a, 400), rapportDelta: deltas.a },
      b: { thought: trim(draft.inner_thought_b, 400), rapportDelta: deltas.b },
    },
    moves: [...new Set(draft.perceived_moves.filter(isMoveId))].slice(0, 6),
    tension,
    tensionDelta,
    rapport,
    ended: Boolean(endReason),
    endReason,
    agreement: endReason === "agreement" ? trim(draft.agreement, 400) || undefined : undefined,
    wrapUp: turnNumber >= MEDIATION_TURN_SOFT_CAP,
  };
}
