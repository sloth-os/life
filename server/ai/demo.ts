// Scripted "Demo AI": the same three agents implemented with transparent
// heuristics, so the full game runs (and is testable) without an API key.
// Facts still come from real sources (Wikipedia extracts in the grounding).
import { findPostcard } from "../../shared/destinations.ts";
import { clamp, clampDelta } from "../../shared/rules.ts";
import { SKILL_IDS, SKILLS, type SkillId } from "../../shared/skills.ts";
import { LENS_IDS, LENSES, MOVES, SCENARIOS, type EmotionId, type LensId, type MoveId, type ScenarioId } from "../../shared/world.ts";
import type { AskRequest, DebriefRequest, HintRequest, MediationDebriefRequest, MediationSceneRequest, PlayerTurn, TranscriptEntry } from "../../shared/schemas.ts";
import type { AskDraft, DebriefDraft, ExpeditionDraft, HintDraft, InsightDraft, MediationTurnDraft, NpcDraft, NpcTurnDraft, PersonaDraft, SceneDraft } from "./schemas.ts";
import type { ComposeExpeditionInput, CreatePersonaInput, GameAI, MediationTurnInput, NpcTurnInput } from "./types.ts";
import { FALLBACK_GREETING, FIELD_MISSIONS, GLOBAL_NAMES, GREETINGS, NAMES, REFLECTION_QUESTIONS, ROLES, SCENARIOS_FOR_SKILL, SCENARIO_TEMPLATES, SCENE_TEMPLATES } from "./demoText.ts";

// ── Deterministic helpers ────────────────────────────────────────────────
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function pick<T>(items: readonly T[], seed: number): T {
  return items[seed % items.length]!;
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“"])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ── Move detection ───────────────────────────────────────────────────────
const STOPWORDS = new Set(
  "about after again also always because been before being could does doing every from have here into just like little make many more most much other over really said same should some still such than that their them then there these they thing think this those very what when where which while with would your you're".split(" "),
);

function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STOPWORDS.has(w)),
  );
}

const RE = {
  greeting: /^(hi|hello|hey|good (morning|afternoon|evening)|hola|bonjour|habari|jambo|namaste|konnichiwa|salaam?|ciao|hallo|ol[áa]|kia ora|sawubona|xin ch[àa]o|merhaba|bom dia|buenos d[íi]as)\b/i,
  farewell: /\b(bye|goodbye|see you|take care|have a (good|great|nice|lovely) (day|one|evening|night)|farewell|i should (go|get going)|i'll let you (go|get back))\b/i,
  gratitude: /\b(thank|thanks|grateful|appreciate)\b/i,
  openStart: /^(so,?\s+)?(what|how|why|which|where|who|tell me|could you (tell|describe|explain)|can you (tell|describe|explain)|would you (tell|describe|share)|i'?d love to (hear|know))/i,
  openAnywhere: /\b(what (is|was|are|do|does|did|makes|made)|how (do|does|did|is|was|has|have|come)|why (do|does|did|is)|tell me (about|more)|what's it like)\b/i,
  closedStart: /^(do|does|did|is|are|was|were|can|could|will|would|have|has|should|shall)\b/i,
  reflection: /\b(sounds like|so you|it seems|you('re| are) saying|if i understand|you mean|you feel|you must feel|that must|so it's|so that's)\b/i,
  empathy: /\b(that must be|sounds (hard|difficult|tough|frustrating|exhausting|stressful|lonely|scary)|i('m| am) (so )?sorry|i can imagine|i understand|that's (hard|tough|a lot|rough)|must be (hard|difficult|tough|tiring)|that's a lot to)\b/i,
  affirmation: /\b(amazing|impressive|beautiful|wonderful|admire|inspiring|that's (great|cool|lovely|incredible)|you('re| are) (so )?(skilled|talented|brave|strong|kind))\b/i,
  selfDisclosure: /\b(i('m| am) from|where i('m| am) from|in my (country|town|city|family|home)|my (mom|mum|dad|grandmother|grandfather|family|job|work|kids|daughter|son))\b/i,
  commonGround: /\b(me too|same (here|for me)|we both|i also|i too|in common|just like you|i feel the same)\b/i,
  respectfulCheck: /\b(is it ok(ay)?|would it be (ok|okay|alright|rude)|may i|do you mind|is it rude|i don't want to assume|how do (people|you) usually|is it appropriate|if you don't mind|if that's ok(ay)?|am i allowed)\b/i,
  clearRequest: /\b(could you (help|show|recommend|point)|i('m| am) looking for|i need|i would like|i'd like|can you help|would you (mind )?help|could i (buy|get|have)|what would be a fair)\b/i,
  humor: /\b(haha|lol|joke)\b|😄|😂/i,
  assumption: /\b(you (people|guys|lot)|all of you|your people|everyone here (must|is|always)|(must|are) all (be )?(poor|rich|lazy|the same|religious)|must be (so )?(poor|dangerous)|exotic|primitive|backward|savage|uncivili[sz]ed|third[- ]world|do you (even )?have (internet|electricity|phones|cars)|isn't it dangerous)\b/i,
  judgment: /\b(that's (wrong|stupid|weird|gross|disgusting|crazy)|you should(n't)? (just|really)|why don't you just|that's not (right|normal))\b/i,
  rude: /\b(shut up|stupid|idiot|whatever|boring|i don't care|dumb|ugly|loser)\b/i,
  pushy: /\b(just tell me|tell me now|come on|you have to|give me|hurry( up)?|right now|i insist|last price)\b/i,
};

export function detectMoves(text: string, ctx: { lastNpcText?: string; greeting?: string; firstTurn: boolean }): MoveId[] {
  const t = text.trim();
  const moves = new Set<MoveId>();
  const questionCount = (t.match(/\?/g) ?? []).length;
  const isQuestion = questionCount > 0;
  const lower = t.toLowerCase();
  const greetingWord = ctx.greeting?.toLowerCase().replace(/[?!.]/g, "");

  if (RE.greeting.test(t) || (greetingWord && greetingWord.length > 1 && lower.includes(greetingWord))) moves.add("greeting");
  if (RE.farewell.test(t)) moves.add("farewell");
  if (RE.gratitude.test(t)) moves.add("gratitude");
  if (RE.reflection.test(t)) moves.add("reflection");
  if (RE.empathy.test(t)) moves.add("empathy");
  if (RE.affirmation.test(t)) moves.add("affirmation");
  if (RE.selfDisclosure.test(t)) moves.add("self_disclosure");
  if (RE.commonGround.test(t)) moves.add("common_ground");
  if (RE.respectfulCheck.test(t)) moves.add("respectful_check");
  if (RE.clearRequest.test(t)) moves.add("clear_request");
  if (RE.humor.test(t)) moves.add("humor");
  if (RE.assumption.test(t)) moves.add("assumption");
  if (RE.judgment.test(t)) moves.add("judgment");
  if (RE.rude.test(t)) moves.add("rude");
  if (RE.pushy.test(t)) moves.add("pushy");

  const clauses = t.split(/(?<=[.!?])\s+/);
  const open = clauses.some((c) => c.includes("?") && (RE.openStart.test(c.trim()) || RE.openAnywhere.test(c))) || /\b(tell me (about|more)|i'?d love to hear)\b/i.test(t);
  if (open) moves.add("open_question");
  else if (isQuestion && clauses.some((c) => RE.closedStart.test(c.trim()))) moves.add("closed_question");
  else if (isQuestion) moves.add("open_question");

  if (ctx.lastNpcText && (isQuestion || moves.has("reflection"))) {
    const shared = [...contentWords(t)].filter((w) => contentWords(ctx.lastNpcText!).has(w));
    if (shared.length >= 1 && isQuestion) moves.add("follow_up");
    if (shared.length >= 2 && /^so\b/i.test(t)) moves.add("reflection");
  }
  if (questionCount >= 3) moves.add("interrogating");
  const selfWords = (lower.match(/\b(i|me|my|mine|i'm|i've)\b/g) ?? []).length;
  if (t.length > 200 && selfWords >= 6 && !isQuestion) moves.add("self_focus");
  const words = t.split(/\s+/).filter(Boolean).length;
  if (moves.size === 0) {
    if (words <= 3 && ctx.lastNpcText?.includes("?")) moves.add("ignoring");
    else if (words <= 2) moves.add("vague");
    else moves.add("small_talk");
  }
  return [...moves].slice(0, 6);
}

const MOVE_POINTS: Record<MoveId, number> = {
  greeting: 2,
  open_question: 5,
  closed_question: 1,
  follow_up: 4,
  reflection: 6,
  empathy: 6,
  affirmation: 3,
  gratitude: 2,
  self_disclosure: 2,
  common_ground: 3,
  respectful_check: 4,
  clear_request: 3,
  humor: 2,
  small_talk: 1,
  farewell: 0,
  assumption: -8,
  judgment: -6,
  ignoring: -3,
  interrogating: -3,
  self_focus: -4,
  pushy: -6,
  rude: -12,
  vague: -2,
};

export function demoDelta(moves: MoveId[], difficulty: 1 | 2 | 3, firstTurn: boolean): number {
  let positive = 0;
  let negative = 0;
  for (const move of moves) {
    if (move === "greeting" && !firstTurn) continue;
    const points = MOVE_POINTS[move];
    if (points > 0) positive += points;
    else negative += points;
  }
  const scale = difficulty === 1 ? 1.2 : difficulty === 3 ? 0.75 : 1;
  return clampDelta(Math.round(positive * scale) + negative);
}

// ── Quiz builder for demo insights (cloze questions from real sentences) ─
const NUMBER_RE = /\b\d+(?:[.,]\d+)*(?:\s?(?:%|percent|million|billion|km|metres|meters))?(?!\d)/;
const GENERIC_WORDS = /^(The|This|That|These|Avenue|Street|Road|Square|Park|City|Town|Island|River|North|South|East|West|Central)$/;
const PROPER_RE = /(?<=\s)(?:[A-Z][\p{L}'’-]+)(?:\s+(?:of|the|de|del|la|and|du)?\s*[A-Z][\p{L}'’-]+)*/u;

function perturbNumber(answer: string, seed: number): string[] {
  const match = /([\d,.]+)(.*)/.exec(answer);
  if (!match) return [];
  const raw = match[1]!;
  const suffix = match[2] ?? "";
  const value = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(value)) return [];
  const isYear = Number.isInteger(value) && value >= 1000 && value <= 2100 && !suffix;
  const decimals = raw.includes(".") && !raw.includes(",") ? (raw.split(".")[1]?.length ?? 0) : 0;
  const fmt = (n: number) => (decimals ? n.toFixed(decimals) : Math.round(n).toLocaleString("en-US")).replace(/,/g, raw.includes(",") ? "," : "") + suffix;
  const variants = isYear ? [value - 12 - (seed % 20), value + 9 + (seed % 15), value - 41 - (seed % 30)] : [value * 2, value / 2, value * 1.5 + 3];
  return variants.map((v) => (isYear ? String(Math.round(v)) : fmt(v))).filter((v) => v !== answer);
}

export function buildQuiz(fact: string, otherFacts: string[], seed: number): InsightDraft["quiz"] {
  const otherPropers = otherFacts.flatMap((f) => [...f.matchAll(new RegExp(PROPER_RE.source, "gu"))].map((m) => m[0])).filter(Boolean);
  let answer: string | undefined;
  let distractors: string[] = [];
  const number = NUMBER_RE.exec(fact)?.[0];
  if (number && number.replace(/\D/g, "").length >= 2) {
    answer = number.trim();
    distractors = perturbNumber(answer, seed);
  } else {
    const proper = PROPER_RE.exec(` ${fact}`)?.[0];
    if (proper && proper.length > 3) {
      answer = proper;
      distractors = [...new Set(otherPropers.filter((p) => p !== proper && !fact.includes(p) && (p.includes(" ") || p.length >= 5) && !GENERIC_WORDS.test(p)))].slice(0, 3);
    }
  }
  if (!answer || distractors.length < 3) {
    const statements = [fact, ...otherFacts.filter((f) => f !== fact)].slice(0, 4).map((s) => (s.length > 120 ? `${s.slice(0, 117)}…` : s));
    while (statements.length < 2) statements.push("None of these");
    const order = statements.map((s, i) => ({ s, k: hashString(`${s}${seed}${i}`) })).sort((a, b) => a.k - b.k);
    return { question: "Which of these did you learn on this trip?", options: order.map((o) => o.s), answer_index: order.findIndex((o) => o.s === statements[0]) };
  }
  const options = [answer, ...distractors.slice(0, 3)];
  const shuffled = options.map((o, i) => ({ o, k: hashString(`${o}${seed}${i}`) })).sort((a, b) => a.k - b.k).map((x) => x.o);
  // Keep the question short: a window of the sentence around the blank.
  const at = fact.indexOf(answer);
  const start = Math.max(0, at - 70);
  const end = Math.min(fact.length, at + answer.length + 70);
  const window = `${start > 0 ? "…" : ""}${fact.slice(start, at)}_____${fact.slice(at + answer.length, end)}${end < fact.length ? "…" : ""}`;
  return { question: `Fill in the blank: “${window.trim()}”`, options: shuffled, answer_index: shuffled.indexOf(answer) };
}

// ── Notes parsing: "[W0] Title: text" lines written by the demo expedition ─
interface NoteFact {
  sourceId: string;
  title: string;
  sentence: string;
}

function factsFromNotes(notes: string): NoteFact[] {
  const facts: NoteFact[] = [];
  for (const line of notes.split("\n")) {
    const match = /^\[([A-Z]+\d*)\]\s*([^:]+):\s*(.+)$/.exec(line.trim());
    if (!match) continue;
    const title = match[2]!.trim();
    const subject = title.replace(/\s*\([^)]*\)$/, "");
    sentences(match[3]!).forEach((raw, index) => {
      // Later sentences often lean on the first ("It is…"); restore the subject or skip them.
      let sentence = raw;
      if (index > 0) {
        if (/^It(?:'s| is| was| has)\b/.test(sentence)) sentence = sentence.replace(/^It\b/, subject);
        else if (/^Its\b/.test(sentence)) sentence = sentence.replace(/^Its\b/, `${subject}'s`);
        else if (/^(He|She|They|This|These|Those|There)\b/.test(sentence)) return;
      }
      if (sentence.length >= 50 && sentence.length <= 260) facts.push({ sourceId: match[1]!, title, sentence });
    });
  }
  return facts;
}

// ── Personality building blocks ─────────────────────────────────────────
const PERSONALITY: Record<LensId, string[]> = {
  nature: ["Patient and observant; notices birds before people. Has strong opinions about litter.", "Restless outdoors type who can't sit still; laughs easily, especially at themselves."],
  culture: ["Expressive and proud of their craft; a perfectionist who hums while working.", "Warm but a little shy at first; lights up when someone asks about the details."],
  history: ["Talkative and precise; loves a good story and hates when people get dates wrong.", "Thoughtful and dry-witted; collects old postcards and grumbles about modern buildings."],
  society: ["Practical and caring; always busy, always helping someone, rarely resting.", "Direct and funny; has no patience for small talk but loves real conversations."],
  economy: ["Quick, sharp and sociable; knows everyone's business and everyone's prices.", "Steady and hard-working; trusts actions more than words and remembers regular customers."],
};

const HIDDEN_CONCERN: Record<LensId, string> = {
  nature: "the weather has been changing the land and water they depend on, and they worry what it will look like for their kids",
  culture: "young people seem less interested in the traditions they love, and they fear being the last one who knows how",
  history: "old buildings and stories keep disappearing as the city changes, and nobody seems to mind",
  society: "they are exhausted from holding things together for their community with too little support",
  economy: "rising costs mean the business might not survive another year",
};

const GESTURE: Record<LensId, string> = {
  nature: "brushes soil off their hands",
  culture: "sets down what they were working on",
  history: "closes a worn notebook",
  society: "glances at their watch, then at you",
  economy: "straightens a row of goods",
};

function pronounsFor(name: string): string {
  for (const pool of [...Object.values(NAMES), GLOBAL_NAMES]) {
    const found = pool.find(([n]) => n === name);
    if (found) return found[1];
  }
  return "they/them";
}

const PLACE_WORDS =
  /\b(street|road|avenue|market|bazaar|souk|square|plaza|park|garden|temple|shrine|church|mosque|cathedral|museum|station|bridge|river|harbou?r|port|beach|lake|hill|mount|castle|palace|fort|gate|quarter|district|old town|medina|ghat|pier|wharf|hall|library|stadium|university|school)\b|-(dō|ji|jinja|dera)$/i;

/** First-person things a demo local can say about their life (persona fields are third-person notes). */
function talkingPoints(role: string, placeName: string, situation: string, lens: LensId, city: string, greeting: { phrase: string; meaning: string }): string[] {
  const right = situation.replace(/\.$/, "");
  const lensLine: Record<LensId, string> = {
    economy: "Prices have gone up a lot this year — everyone around here feels it.",
    nature: "The weather's been strange lately. You notice it when you work outside every day.",
    culture: "I learned all this from my family. It's something we're proud of.",
    history: "This street has seen a lot. My grandparents remembered it very differently.",
    society: "Some days it feels like the whole neighbourhood depends on a few tired people.",
  };
  return [
    `I've been a ${role} for years — ${placeName} is basically my second home.`,
    `Right now I'm ${lowerFirst(right)}.`,
    lensLine[lens],
    greeting.phrase !== "Hello" ? `People here say “${greeting.phrase}” to each other — it means ${lowerFirst(greeting.meaning.replace(/^Hello — /, ""))}.` : `People in ${city} are friendlier than they look, I promise.`,
    `Mornings start early here, and evenings belong to family and friends.`,
    `What I love about ${city}? The people. Everyone knows everyone around ${placeName}.`,
  ];
}

function partOfDay(localTime?: string): string {
  return /\((\w+)\)/.exec(localTime ?? "")?.[1] ?? "a busy day";
}

// ── Engine ───────────────────────────────────────────────────────────────
export class DemoGameAI implements GameAI {
  readonly mode = "demo" as const;
  readonly #typingDelayMs: number;

  constructor(opts: { typingDelayMs?: number } = {}) {
    this.#typingDelayMs = opts.typingDelayMs ?? 18;
  }

  async composeExpedition(input: ComposeExpeditionInput): Promise<ExpeditionDraft> {
    const { destination, pack, player } = input;
    const seed = hashString(`${destination.lat.toFixed(3)},${destination.lng.toFixed(3)}`);
    const postcard = findPostcard(destination.postcardId);
    const country = pack.locality.country ?? postcard?.country ?? destination.country ?? "";
    const city = pack.locality.city ?? postcard?.name ?? destination.label;
    const greeting = GREETINGS[country] ?? FALLBACK_GREETING;

    const lenses: LensId[] = [];
    for (const lens of [...(postcard?.lenses ?? []), ...LENS_IDS.map((_, i) => LENS_IDS[(seed + i) % LENS_IDS.length]!)]) {
      if (!lenses.includes(lens)) lenses.push(lens);
    }
    const preferred = SCENARIOS_FOR_SKILL[player.focusSkill];
    const scenarios: ScenarioId[] = [preferred[0]!, preferred[1]!, preferred.includes("conversation") ? "ask_help" : "conversation"];
    const d = input.suggestedDifficulty;
    const difficulties = [d, Math.max(1, d - 1), Math.min(3, d + 1)];
    const pool = NAMES[country] ?? GLOBAL_NAMES;
    // Prefer articles that sound like physical places people spend time in.
    const placeLike = (name = "") => (PLACE_WORDS.test(name) ? 0 : 1);
    const places = pack.places.filter((p) => p.location && p.name).sort((a, b) => placeLike(a.name) - placeLike(b.name));

    const npcs: NpcDraft[] = [0, 1, 2].map((i) => {
      const lens = lenses[i]!;
      const scenario = scenarios[i]!;
      const [name] = pool[(seed + i * 2) % pool.length]!;
      const place = places[i];
      const template = SCENARIO_TEMPLATES[scenario];
      return {
        name,
        age: 22 + ((seed >>> (i * 3)) % 45),
        role: pick(ROLES[lens], seed + i),
        place_source_id: place?.sourceId ?? null,
        place_name: place?.name ?? `a street corner in ${city}`,
        lens,
        scenario,
        difficulty: difficulties[i]!,
        hook: template.hook,
        goal: template.goal.replaceAll("{name}", name).replaceAll("{city}", city),
      };
    });

    const nearest = places[0]?.name;
    const notes = pack.articles
      .map((a) => `[${a.sourceId}] ${a.title}: ${sentences(a.extract).slice(0, 3).join(" ")}`)
      .join("\n")
      .slice(0, 2400);

    return {
      title: `${city}: ${pick(["Street Stories", "A Day in the Life", "Local Voices", "First Impressions", "Around the Corner"], seed)}`,
      scene: `It's ${partOfDay(pack.localTime)} in ${city}${pack.weather ? ` — ${pack.weather.summary}` : ""}. You're standing near ${nearest ?? "the centre of town"}, where ${pick(["people hurry past with bags of shopping", "a radio plays somewhere above the street", "the smell of something frying drifts over", "a delivery bike weaves through the crowd"], seed + 1)}.`,
      locality: { city, region: pack.locality.region ?? "", country },
      greeting: { language: greeting.language, phrase: greeting.phrase, meaning: greeting.meaning, pronunciation: greeting.pronunciation },
      curiosity: [
        `What do people in ${city} do for work, and how is that changing?`,
        "What's a local tradition that visitors usually miss?",
        `How do the landscape and climate shape daily life in ${city}?`,
      ],
      notes: notes || `${city}${country ? `, ${country}` : ""}. (No encyclopedia sources were available; keep facts general.)`,
      npcs,
    };
  }

  async createPersona(input: CreatePersonaInput): Promise<PersonaDraft> {
    const { npc, context, memory } = input.request;
    const seed = hashString(`${npc.id}${npc.name}`);
    const city = context.locality.city ?? context.destinationLabel;
    const template = SCENARIO_TEMPLATES[npc.scenario];
    const years = 3 + (seed % 25);

    const facts = factsFromNotes(context.notes);
    const chosen: NoteFact[] = [];
    for (const fact of [...facts].sort((a, b) => hashString(a.sentence + seed) - hashString(b.sentence + seed))) {
      if (chosen.length === 3) break;
      if (!chosen.some((c) => c.sourceId === fact.sourceId) || facts.length < 6) chosen.push(fact);
    }
    const otherLenses = LENS_IDS.filter((l) => l !== npc.lens);
    const insights: InsightDraft[] = chosen.map((fact, i) => ({
      lens: i === 0 ? npc.lens : pick(otherLenses, seed + i),
      title: fact.title.split(/\s+/).slice(0, 6).join(" "),
      fact: fact.sentence,
      source_ids: [fact.sourceId],
      quiz: buildQuiz(fact.sentence, facts.filter((f) => f !== fact).map((f) => f.sentence), seed + i),
    }));
    while (insights.length < 3) {
      const lens = insights.length === 0 ? npc.lens : pick(otherLenses, seed + insights.length);
      insights.push({
        lens,
        title: `${LENSES[lens].name} in ${city}`,
        fact: `Life in ${city} is shaped by its ${LENSES[lens].description.toLowerCase()}, and locals see it differently from visitors.`,
        source_ids: [],
        quiz: { question: `Who is the best guide to ${LENSES[lens].name.toLowerCase()} in ${city}?`, options: ["The people who live there", "A souvenir shop", "A billboard", "Nobody"], answer_index: 0 },
      });
    }

    const opening = memory
      ? `Oh — it's you again! Good to see you.`
      : npc.difficulty === 1
        ? `Oh, hello! You look like you're exploring — ${pick(["can I help?", "first time around here?"], seed)}`
        : npc.difficulty === 2
          ? "Yes? Can I help you with something?"
          : "Hm. Another visitor. What is it?";

    return {
      pronouns: pronounsFor(npc.name),
      personality: pick(PERSONALITY[npc.lens], seed),
      communication_style:
        npc.difficulty === 1 ? "Chatty and warm, with quick jokes." : npc.difficulty === 2 ? "Polite but brief until they warm up." : "Dry and guarded; answers questions with questions.",
      background: `${npc.name} has worked as a ${npc.role} in ${city} for ${years} years. Mornings start early, and evenings belong to family and friends. They know ${npc.placeName} better than almost anyone.`,
      current_situation: `${upperFirst(template.situation)}${context.weatherSummary ? `; it's ${context.weatherSummary} today` : ""}.`,
      hidden_concern: upperFirst(HIDDEN_CONCERN[npc.lens]) + ".",
      boundaries: ["Being photographed without being asked", "People treating the neighbourhood like a theme park"],
      language_notes: `Speaks ${context.greeting.language === "the local language" ? "the local language" : context.greeting.language} and some English. Greets friends with “${context.greeting.phrase}” (${context.greeting.meaning}).`,
      scenario_brief: template.brief,
      opening_line: opening,
      opening_gesture: GESTURE[npc.lens],
      insights,
    };
  }

  async #type(text: string, onReply?: (soFar: string) => void): Promise<void> {
    if (!onReply) return;
    const words = text.split(/(\s+)/);
    let soFar = "";
    for (const word of words) {
      soFar += word;
      if (word.trim()) {
        onReply(soFar);
        if (this.#typingDelayMs > 0) await new Promise((r) => setTimeout(r, this.#typingDelayMs));
      }
    }
  }

  async npcTurn(input: NpcTurnInput, onReply?: (replySoFar: string) => void): Promise<NpcTurnDraft> {
    const req = input.request;
    const { persona, npc, context } = req;
    const seed = hashString(`${req.playerMessage}${input.turnNumber}`);
    const lastNpc = [...req.transcript].reverse().find((e): e is Extract<TranscriptEntry, { speaker: "npc" }> => e.speaker === "npc");
    const firstTurn = !req.transcript.some((e) => e.speaker === "player");
    const moves = detectMoves(req.playerMessage, { lastNpcText: lastNpc?.text, greeting: context.greeting.phrase, firstTurn });
    const delta = demoDelta(moves, npc.difficulty, firstTurn);
    const after = clamp(req.rapport + delta, 0, 100);
    const has = (m: MoveId) => moves.includes(m);
    const engaged = moves.some((m) => ["open_question", "follow_up", "reflection", "empathy", "respectful_check", "common_ground", "clear_request", "self_disclosure"].includes(m));
    const nextInsight = persona.insights.find((i) => !req.unlockedInsightIds.includes(i.id) && after >= i.threshold);
    const city = context.locality.city ?? context.destinationLabel;
    const details = talkingPoints(persona.role, persona.placeName, persona.currentSituation, npc.lens, city, context.greeting);

    let reply: string;
    let emotion: EmotionId = after >= 50 ? "warm" : npc.difficulty >= 2 && after < 25 ? "busy" : "curious";
    let ended = false;
    let revealed: string[] = [];
    let phrase: NpcTurnDraft["phrase"] = null;
    let thought: string;

    if (has("rude") || has("assumption") || has("judgment") || has("pushy")) {
      emotion = "annoyed";
      if (after <= 0) {
        ended = true;
        reply = pick(["I don't think this is going anywhere. Excuse me.", "I have work to do. Goodbye."], seed);
      } else if (has("assumption")) {
        reply = pick(["Hm. That's not really how it is here, you know.", "People say that a lot. It isn't true."], seed);
      } else {
        reply = pick(["I'd rather you didn't talk to me like that.", "Easy. I'm not here to be rushed."], seed);
      }
      thought = has("assumption") ? "Another visitor with assumptions about us." : has("pushy") ? "Too pushy — I don't like being pressured." : "That was rude.";
    } else if (has("farewell")) {
      ended = true;
      emotion = after >= 50 ? "warm" : "neutral";
      reply = after >= 50 ? `Take care, ${req.player.name}! ${context.greeting.phrase !== "Hello" ? "Come back and say " + context.greeting.phrase + " again sometime." : "Come back anytime."}` : "Alright. Enjoy the rest of your day.";
      thought = after >= 50 ? "I enjoyed that conversation." : "Pleasant enough.";
    } else if (nextInsight && engaged) {
      revealed = [nextInsight.id];
      emotion = "excited";
      reply = `${pick(["Since you ask —", "Here's something most visitors never hear:", "You know what I always tell people?", "Well, it's like this:"], seed)} ${nextInsight.fact}`;
      thought = "They actually care — I'm happy to share this.";
    } else if (has("empathy") || has("reflection")) {
      emotion = after >= 60 ? "touched" : "warm";
      reply =
        after >= 60
          ? `Yes… exactly. To be honest, ${lowerFirst(persona.hiddenConcern)}`
          : `${pick(["Yes, exactly — you get it.", "Mm, that's it. Not everyone notices that.", "Right. It's good to hear someone say it."], seed)} ${pick(details, input.turnNumber)}`;
      thought = has("empathy") ? "That felt kind — they noticed how I feel." : "They were really listening.";
    } else if (has("open_question") || has("follow_up")) {
      reply = `${pick(["Well,", "Hmm, let me think.", "Good question."], seed)} ${pick(details, input.turnNumber + 1)}${input.turnNumber % 3 === 0 ? ` And you — what brings you to ${city}?` : ""}`;
      thought = has("follow_up") ? "They remembered what I said." : "A real question — nice.";
    } else if (has("clear_request")) {
      reply =
        npc.scenario === "negotiate"
          ? after >= 40
            ? "For you? Let's meet in the middle — that's fair for both of us."
            : "That's my price. Quality costs something, you know."
          : `Sure, I can help with that. Ask for directions at ${persona.placeName} — everyone here knows it.`;
      thought = "At least they're clear about what they want.";
    } else if (has("closed_question")) {
      reply = `${pick(["Mostly, yes.", "Sometimes — it depends on the day.", "Yes, though it's more complicated than that."], seed)}${input.turnNumber % 2 === 0 ? " Why do you ask?" : ""}`;
      thought = "Short question, short answer.";
    } else if (has("greeting")) {
      reply = `${context.greeting.phrase !== "Hello" ? context.greeting.phrase + "! " : "Hello! "}${pick(["Not many visitors greet me like that.", "So, what can I do for you?"], seed)}`;
      if (context.greeting.phrase !== "Hello") phrase = { text: context.greeting.phrase, meaning: context.greeting.meaning };
      thought = "A friendly start.";
    } else if (has("ignoring") || has("self_focus") || has("vague")) {
      emotion = "guarded";
      reply = pick(["Oh. Okay.", "Right…", "Mm-hm."], seed) + ` ${pick(["Anyway.", "I should keep working."], seed + 1)}`;
      thought = has("self_focus") ? "They mostly want to talk about themselves." : "Did they even hear what I said?";
    } else {
      reply = `${pick(["Mm, yes.", "That's true.", "Ha, maybe."], seed)} ${pick(details, input.turnNumber + 2)}`;
      thought = "Hard to read them so far.";
    }
    if (!phrase && context.greeting.phrase !== "Hello" && reply.includes(`“${context.greeting.phrase}”`)) {
      phrase = { text: context.greeting.phrase, meaning: context.greeting.meaning };
    }
    if (input.wrapUp && !ended) reply += " Anyway — I should get back to it soon.";

    await this.#type(reply, onReply);
    return {
      reply,
      gesture: ended ? "turns back to their work" : revealed.length ? "leans in a little" : "",
      emotion,
      rapport_delta: delta,
      perceived_moves: moves,
      inner_thought: thought,
      revealed_insight_ids: revealed,
      phrase,
      conversation_state: ended ? "ended" : "ongoing",
    };
  }

  async coachHint(request: HintRequest): Promise<HintDraft> {
    const playerTurns = request.transcript.filter((e): e is PlayerTurn => e.speaker === "player");
    const moves = new Set(playerTurns.flatMap((t) => t.moves ?? []));
    const lastNpc = [...request.transcript].reverse().find((e) => e.speaker === "npc");
    const name = request.persona.name;
    const feeling = /\b(tired|worr|frustrat|hard|busy|miss|sad|stress|annoy|exhaust|difficult)\w*/i.exec(lastNpc?.text ?? "")?.[0];

    if (!moves.has("open_question")) {
      return {
        skill: "curiosity",
        observation: playerTurns.length ? "So far your questions invite short answers." : "You're about to start the conversation.",
        suggestion: `Ask ${name} an open question about something they're doing right now — “what” and “how” questions invite stories.`,
        example: `What's the best part of working at ${request.persona.placeName}?`,
      };
    }
    if (feeling && !moves.has("empathy")) {
      return {
        skill: "empathy",
        observation: `${name} just mentioned feeling ${feeling.toLowerCase()}.`,
        suggestion: "Acknowledge that feeling before asking anything else. It shows you heard more than the words.",
        example: "That sounds like a lot — how are you holding up?",
      };
    }
    if (["ask_help", "negotiate", "collaborate"].includes(request.npc.scenario) && !moves.has("clear_request")) {
      return {
        skill: "clarity",
        observation: "Your goal needs a clear request, and you haven't made one yet.",
        suggestion: "Say plainly what you'd like and why — it's easier for people to say yes to a clear, kind ask.",
        example: "Could you help me with something? I'd really appreciate it.",
      };
    }
    if (!moves.has("reflection")) {
      return {
        skill: "listening",
        observation: `${name} has shared a few things with you now.`,
        suggestion: "Before your next question, briefly reflect back what you heard — it shows you were listening.",
        example: "So it sounds like this place means a lot to you…",
      };
    }
    return {
      skill: "empathy",
      observation: "You've built real rapport — this is the moment to go deeper.",
      suggestion: `Ask about what matters to ${name}: their hopes or worries for this place. Then just listen.`,
      example: `What do you hope ${request.context.locality.city ?? "this place"} looks like in ten years?`,
    };
  }

  async debrief(request: DebriefRequest): Promise<DebriefDraft> {
    const turns = request.transcript.filter((e): e is PlayerTurn => e.speaker === "player");
    const name = request.persona.name;
    const pos: Record<SkillId, number> = Object.fromEntries(SKILL_IDS.map((s) => [s, 0])) as Record<SkillId, number>;
    const neg: Record<SkillId, number> = { ...pos };
    for (const turn of turns) {
      for (const move of turn.moves ?? []) {
        const info = MOVES[move];
        if (!info.skill) continue;
        if (info.valence > 0) pos[info.skill] += 1;
        if (info.valence < 0) neg[info.skill] += 1;
      }
    }
    const targeted = SCENARIOS[request.npc.scenario].skills;
    const scores = Object.fromEntries(
      SKILL_IDS.map((s) => {
        if (pos[s] === 0 && neg[s] === 0) return [s, targeted.includes(s) && turns.length > 0 ? 1 : null];
        return [s, clamp(Math.round(1 + pos[s] - neg[s] * 1.5), 0, 4)];
      }),
    ) as DebriefDraft["scores"];

    const evidence: DebriefDraft["evidence"] = [];
    for (const turn of turns) {
      const move = (turn.moves ?? []).find((m) => MOVES[m].skill && MOVES[m].valence !== 0);
      if (!move || evidence.length >= 4) continue;
      const info = MOVES[move];
      const quote = turn.text.length > 140 ? turn.text.slice(0, 140) : turn.text;
      evidence.push({ skill: info.skill!, quote, note: `${upperFirst(info.label)} — ${lowerFirst(info.description)}.`, positive: info.valence > 0 });
    }

    const scored = SKILL_IDS.filter((s) => scores[s] !== null) as SkillId[];
    const best = [...scored].sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0))[0] ?? "curiosity";
    const growthSkill = [...(targeted.length ? targeted : scored)].sort((a, b) => (scores[a] ?? 0) - (scores[b] ?? 0))[0] ?? request.player.focusSkill;
    const weakTurn = turns.find((t) => (t.moves ?? []).some((m) => MOVES[m].valence < 0)) ?? turns.find((t) => t.moves?.includes("closed_question")) ?? turns[0];
    const original = weakTurn?.text ?? "";
    const rewrites: Record<SkillId, (o: string) => string> = {
      curiosity: (o) => `${o.replace(/[?.!]+$/, "")} — what's that like for you?`,
      listening: () => "So if I've got it right, this place means a lot to you — is that it?",
      empathy: (o) => `That sounds like a lot. ${o}`,
      respect: (o) => `I don't want to assume — ${lowerFirst(o)}`,
      clarity: (o) => `Could you help me with something? ${o}`,
      common_ground: (o) => `I can relate to that. ${o}`,
    };

    const values = Object.values(scores).filter((s): s is number => typeof s === "number");
    const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const gap = request.selfRating - 1 - mean;
    const insights = request.unlockedInsightIds.length;
    const goalAchieved = insights >= 2 || request.rapport >= 55;
    const titles = request.persona.insights.filter((i) => request.unlockedInsightIds.includes(i.id)).map((i) => i.title.toLowerCase());

    return {
      headline: request.endReason === "walked_away" ? `${name} walked away — let's see why.` : goalAchieved ? `You earned ${name}'s trust.` : `A start with ${name} — room to go deeper.`,
      summary: `You talked with ${name} at ${request.persona.placeName}. Rapport went from ${Math.round(request.startRapport)} to ${Math.round(request.rapport)} and you discovered ${insights} of ${request.persona.insights.length} insights.${pos.curiosity ? " Your questions opened doors." : " More open questions would have opened more doors."}`,
      scores,
      evidence,
      strengths: [`${SKILLS[best].name}: ${SKILLS[best].tagline}`],
      growth: { skill: growthSkill, tip: SKILLS[growthSkill].tagline, original, rewrite: original ? rewrites[growthSkill](original) : SKILLS[growthSkill].example },
      calibration:
        Math.abs(gap) < 0.75 ? "Your self-rating matched the mentor's view closely — good self-awareness." : gap > 0 ? "You rated yourself a bit higher than the evidence shows — look at the moments where rapport dipped." : "You were harder on yourself than the evidence suggests — some of your moves landed well.",
      reflection_question: REFLECTION_QUESTIONS[growthSkill],
      field_mission: { ...FIELD_MISSIONS[growthSkill], skill: growthSkill },
      goal_achieved: goalAchieved,
      memory: `${request.player.name} stopped by and ${pos.curiosity + pos.listening > 1 ? "asked thoughtful questions" : "chatted for a bit"}${titles.length ? `; I told them about ${titles.join(" and ")}` : ""}.`,
    };
  }

  /** Scripted follow-ups: answers drawn from the debrief itself, matched to the kind of question. */
  async askMentor(request: AskRequest, onAnswer?: (answerSoFar: string) => void): Promise<AskDraft> {
    const q = request.question.toLowerCase();
    const { growth, strengths } = request.debrief;
    const skill = SKILLS[growth.skill];
    const turns = request.transcript.filter((e): e is PlayerTurn => e.speaker === "player");
    const best = turns.find((t) => (t.moves ?? []).some((m) => MOVES[m].valence > 0));
    let answer: string;
    if (/\b(why|score|rated|rating|mark)\b/.test(q)) {
      answer = `Scores come from what you actually said. ${best ? `“${best.text.slice(0, 120)}” showed ${MOVES[(best.moves ?? []).find((m) => MOVES[m].valence > 0)!].label}, which counts in your favour. ` : ""}${skill.name} scored lower because ${lowerFirst(growth.tip.replace(/\.$/, ""))}.`;
    } else if (/\b(how|instead|differently|better|rephrase|example|say)\b/.test(q)) {
      answer = growth.original ? `Take your line “${growth.original.slice(0, 120)}”. You could try: “${growth.rewrite}” It keeps your voice but ${lowerFirst(skill.tagline)}` : `Try this: ${skill.example}`;
    } else if (/\b(good|well|strength|right)\b/.test(q)) {
      answer = strengths.length ? `${strengths.join(" ")} Keep doing that — it's what made ${request.persona.name.split(" ")[0]} open up.` : `You showed up and tried, which is the hardest part. Next time, ${lowerFirst(skill.tagline)}`;
    } else {
      answer = `Good question. The biggest lever for you right now is ${skill.name.toLowerCase()}: ${lowerFirst(growth.tip)} A small way to practise: ${lowerFirst(skill.example)}`;
    }
    await this.#type(answer, onAnswer);
    const asked = new Set([...request.history.map((h) => h.question.toLowerCase()), q]);
    const followUps = ["How could I have said that differently?", "What did I do well?", "Why did I get that score?", "How can I practise this in real life?"].filter((f) => !asked.has(f.toLowerCase())).slice(0, 2);
    return { answer, follow_ups: followUps };
  }

  /** A scripted disagreement, with names that fit the place. */
  async createScene(request: MediationSceneRequest): Promise<SceneDraft> {
    const seed = hashString(request.context.expeditionId);
    const t = SCENE_TEMPLATES[seed % SCENE_TEMPLATES.length]!;
    const pool = NAMES[request.context.locality.country ?? ""] ?? GLOBAL_NAMES;
    const [nameA, pronounsA] = pick(pool, seed);
    // A second name, with other pronouns where the pool has them, for a varied pair.
    const others = pool.filter(([n]) => n !== nameA);
    const contrast = others.filter(([, p]) => p !== pronounsA);
    const [nameB, pronounsB] = pick(contrast.length ? contrast : others.length ? others : GLOBAL_NAMES, seed + 1);
    const side = (x: typeof t.a, name: string, pronouns: string, age: number) => ({ name, age, role: x.role, pronouns, position: x.position, interest: x.interest, temperament: x.temperament });
    return {
      title: t.title,
      place_name: t.place,
      situation: t.situation,
      topic: t.topic,
      party_a: side(t.a, nameA, pronounsA, 30 + (seed % 25)),
      party_b: side(t.b, nameB, pronounsB, 28 + ((seed >> 3) % 30)),
      shared_interest: t.shared,
      goal: `Help ${nameA} and ${nameB} find an arrangement they can both live with`,
      opening: [
        { speaker: "a", text: t.start[0], gesture: "gestures at the other" },
        { speaker: "b", text: t.start[1], gesture: "folds their arms" },
      ],
      start_tension: 70,
    };
  }

  /**
   * Scripted mediation: listening and even-handed questions cool things down, taking sides or
   * judging heats them up, and a proposal lands once both feel heard.
   */
  async mediationTurn(input: MediationTurnInput, onReply?: (replySoFar: string) => void): Promise<MediationTurnDraft> {
    const { request } = input;
    const { scene } = request;
    const t = SCENE_TEMPLATES.find((x) => x.topic === scene.topic) ?? SCENE_TEMPLATES[0]!;
    const text = request.playerMessage;
    const lower = text.toLowerCase();
    const moves = detectMoves(text, { firstTurn: input.turnNumber === 1 });
    const [a, b] = scene.parties;
    const mentions = { a: lower.includes(a.name.toLowerCase().split(" ")[0]!), b: lower.includes(b.name.toLowerCase().split(" ")[0]!) };
    const sidesWith = /\b(you'?re right|he'?s right|she'?s right|that'?s not fair|you should just|be reasonable|you'?re wrong)\b/i.test(text);
    const proposes = /\b(what if|how about|could you both|could you each|maybe you|one idea|compromise|take turns|share|split|both of you could)\b/i.test(text);
    const good = moves.filter((m) => MOVES[m].valence > 0).length;
    const bad = moves.filter((m) => MOVES[m].valence < 0).length + (sidesWith ? 1 : 0);

    let tensionDelta = clamp(-5 * good + 9 * bad + (proposes ? -6 : 0), -15, 15);
    if (good === 0 && bad === 0 && !proposes) tensionDelta = 2;
    const delta = (who: "a" | "b") => clampDelta((good ? 4 : 0) + (mentions[who] ? 3 : 0) - (bad ? 6 : 0) - (sidesWith && !mentions[who] ? 6 : 0));
    const ra = request.rapport.a + delta("a");
    const rb = request.rapport.b + delta("b");
    const tension = request.tension + tensionDelta;
    const settles = proposes && tension <= 45 && ra >= 40 && rb >= 40;
    const walks = tension >= 95;

    // Whoever was spoken to answers; otherwise whoever trusts the learner less.
    const first: "a" | "b" = mentions.b && !mentions.a ? "b" : mentions.a ? "a" : ra <= rb ? "a" : "b";
    const second: "a" | "b" = first === "a" ? "b" : "a";
    const say = (who: "a" | "b") => {
      const side = who === "a" ? t.a : t.b;
      const trust = who === "a" ? ra : rb;
      if (settles) return side.warm;
      if (tension > 65) return side.defensive[input.turnNumber % side.defensive.length]!;
      return trust >= 55 ? side.opening : side.warm;
    };
    const replies: MediationTurnDraft["replies"] = [{ speaker: first, text: say(first), gesture: tension > 65 ? "crosses their arms" : "nods slowly", emotion: tension > 65 ? "guarded" : "warm" }];
    if (settles) replies.push({ speaker: second, text: t.accept, gesture: "offers a hand", emotion: "warm" });
    else if (tension <= 55) replies.push({ speaker: second, text: say(second), gesture: "glances at the other", emotion: "curious" });
    await this.#type(replies[0]!.text, onReply);
    const thought = (who: "a" | "b") => (bad ? "Whose side is this stranger on?" : good ? `${who === first ? "They actually listened to me." : "At least they're fair."}` : "Hm. Let's see where this goes.");
    return {
      replies,
      perceived_moves: moves,
      tension_delta: tensionDelta,
      rapport_a_delta: delta("a"),
      rapport_b_delta: delta("b"),
      inner_thought_a: thought("a"),
      inner_thought_b: thought("b"),
      state: settles ? "agreement" : walks ? "walked_away" : "ongoing",
      agreement: settles ? t.agreement : "",
    };
  }

  async mediationDebrief(request: MediationDebriefRequest): Promise<DebriefDraft> {
    const turns = request.transcript.filter((e): e is PlayerTurn => e.speaker === "player");
    const [a, b] = request.scene.parties;
    const pos: Record<SkillId, number> = Object.fromEntries(SKILL_IDS.map((s) => [s, 0])) as Record<SkillId, number>;
    const neg: Record<SkillId, number> = { ...pos };
    for (const turn of turns) {
      for (const move of turn.moves ?? []) {
        const info = MOVES[move];
        if (!info.skill) continue;
        if (info.valence > 0) pos[info.skill] += 1;
        if (info.valence < 0) neg[info.skill] += 1;
      }
    }
    const targeted: SkillId[] = ["listening", "empathy", "common_ground"];
    const scores = Object.fromEntries(
      SKILL_IDS.map((s) => (pos[s] === 0 && neg[s] === 0 ? [s, targeted.includes(s) && turns.length > 0 ? 1 : null] : [s, clamp(Math.round(1 + pos[s] - neg[s] * 1.5), 0, 4)])),
    ) as DebriefDraft["scores"];
    const evidence: DebriefDraft["evidence"] = [];
    for (const turn of turns) {
      const move = (turn.moves ?? []).find((m) => MOVES[m].skill && MOVES[m].valence !== 0);
      if (!move || evidence.length >= 4) continue;
      const info = MOVES[move];
      evidence.push({ skill: info.skill!, quote: turn.text.slice(0, 140), note: `${upperFirst(info.label)} — ${lowerFirst(info.description)}.`, positive: info.valence > 0 });
    }
    const growthSkill = [...targeted].sort((x, y) => (scores[x] ?? 0) - (scores[y] ?? 0))[0]!;
    const original = turns.find((t) => (t.moves ?? []).some((m) => MOVES[m].valence < 0))?.text ?? turns[0]?.text ?? "";
    const agreed = request.endReason === "agreement";
    const values = Object.values(scores).filter((v): v is number => typeof v === "number");
    const mean = values.length ? values.reduce((x, y) => x + y, 0) / values.length : 0;
    const gap = request.selfRating - 1 - mean;
    return {
      headline: agreed ? `You helped ${a.name} and ${b.name} meet in the middle.` : request.endReason === "walked_away" ? "Someone walked off — let's see why." : `A start — ${a.name} and ${b.name} are still at odds.`,
      summary: `You stepped into a disagreement about ${request.scene.topic}. Tension went from ${request.scene.startTension} to ${Math.round(request.tension)}${agreed && request.agreement ? `, and they agreed: ${lowerFirst(request.agreement)}` : "."}`,
      scores,
      evidence,
      strengths: [pos.listening + pos.empathy > 0 ? "You let each of them feel heard before moving on — that's what lowers the temperature." : "You stayed in the conversation when it was uncomfortable."],
      growth: {
        skill: growthSkill,
        tip: "Ask each person what matters to them underneath their demand; the shared interest is usually hiding there.",
        original,
        rewrite: `It sounds like you both want the same street to work — ${a.name}, what would make this fair for you? And ${b.name}?`,
      },
      calibration: Math.abs(gap) < 0.75 ? "Your self-rating matched the mentor's view closely." : gap > 0 ? "You rated yourself a bit higher than the evidence shows." : "You were harder on yourself than the evidence suggests.",
      reflection_question: "When two people you know disagree, do you tend to pick a side, fix it fast, or listen first?",
      field_mission: { title: "Listen to both sides", description: "Next time two friends or family members disagree, summarise each person's view back to them before offering any idea.", skill: "common_ground" },
      goal_achieved: agreed,
      memory: `${request.player.name} stepped in when we were arguing about ${request.scene.topic}${agreed ? " and helped us sort it out" : ""}.`,
    };
  }
}
