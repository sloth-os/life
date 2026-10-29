// The Skill Compass: six observable social skills, each with a 0–4 rubric.
// Grounded in OARS (Motivational Interviewing), active listening, Deardorff's
// intercultural competence model, assertiveness, and interest-based negotiation.

export const SKILL_IDS = ["curiosity", "listening", "empathy", "respect", "clarity", "common_ground"] as const;
export type SkillId = (typeof SKILL_IDS)[number];

export interface SkillInfo {
  id: SkillId;
  name: string;
  icon: string;
  tagline: string;
  /** Observable behaviours the mentor looks for. */
  behaviors: string[];
  /** Habits that work against the skill. */
  pitfalls: string[];
  /** A short model line the learner can adapt. */
  example: string;
  /** Rubric descriptors for scores 0..4. */
  rubric: [string, string, string, string, string];
  /** Where the skill comes from, for the curious. */
  roots: string;
}

export const SKILLS: Record<SkillId, SkillInfo> = {
  curiosity: {
    id: "curiosity",
    name: "Curiosity",
    icon: "🧭",
    tagline: "Ask open questions and follow the thread.",
    behaviors: [
      "Asks open questions (what, how, tell me about…)",
      "Follows up on something the other person just said",
      "Shows genuine interest in their life and world",
    ],
    pitfalls: ["Rapid-fire yes/no questions", "Interview mode without listening", "Steering every topic back to yourself"],
    example: "“What's a normal morning like for you here?”",
    rubric: [
      "No real questions, or only questions about what you need",
      "Mostly closed or generic questions",
      "Some open questions, few follow-ups",
      "Open questions with genuine follow-ups",
      "Questions that build naturally on their answers and open new depth",
    ],
    roots: "OARS: Open questions (Miller & Rollnick); curiosity & discovery (Deardorff)",
  },
  listening: {
    id: "listening",
    name: "Listening",
    icon: "👂",
    tagline: "Show you heard: reflect, paraphrase, build on it.",
    behaviors: [
      "Paraphrases or summarizes what they said",
      "Refers back to details they mentioned earlier",
      "Lets the other person finish a thought before changing topic",
    ],
    pitfalls: ["Ignoring what they just said", "Jumping to advice", "Long monologues about yourself"],
    example: "“So the rent doubled after the new hotels opened — that's a lot to absorb.”",
    rubric: [
      "Ignores or talks over what they said",
      "Acknowledges with minimal tokens (ok, cool)",
      "Occasionally references what they said",
      "Accurate reflections or summaries that move the conversation forward",
      "Reflections capture meaning and feeling; they feel deeply understood",
    ],
    roots: "OARS: Reflections & Summaries; active listening (Rogers)",
  },
  empathy: {
    id: "empathy",
    name: "Empathy",
    icon: "💛",
    tagline: "Notice feelings, name them gently, validate.",
    behaviors: [
      "Notices and names emotions (“that sounds exhausting”)",
      "Validates their perspective before responding",
      "Responds with care when something is hard",
    ],
    pitfalls: ["Minimizing (“at least…”)", "Rushing to fix", "Judging their choices"],
    example: "“That sounds really frustrating, especially after so many years here.”",
    rubric: [
      "Dismissive or judgmental about feelings",
      "Notices feelings only in passing",
      "Some acknowledgement of feelings",
      "Names and validates feelings appropriately",
      "Attuned, well-timed empathy that deepens trust",
    ],
    roots: "Perspective-taking; helping skills (Hill); CARE study (Louie et al., 2025)",
  },
  respect: {
    id: "respect",
    name: "Respect",
    icon: "🙏",
    tagline: "Check assumptions, honor norms and boundaries.",
    behaviors: [
      "Asks rather than assumes (“is it OK if…?”, “how do people here…?”)",
      "Avoids stereotypes and generalizations",
      "Accepts a no or a boundary gracefully",
    ],
    pitfalls: ["Stereotyping (“you must all…”)", "Treating their customs as exotic", "Pushing past a boundary"],
    example: "“I don't want to assume — how do you usually celebrate it here?”",
    rubric: [
      "Stereotyping, condescension, or boundary-pushing",
      "Unexamined assumptions or exoticizing remarks",
      "Polite but sometimes presumptuous",
      "Consistently checks assumptions and honors norms",
      "Humble, curious, and graceful with difference",
    ],
    roots: "Cultural humility; intercultural competence (Deardorff, 2006)",
  },
  clarity: {
    id: "clarity",
    name: "Clarity",
    icon: "🔆",
    tagline: "Say what you need — clearly and kindly.",
    behaviors: [
      "States intentions or requests plainly",
      "Explains the why behind a request",
      "Is assertive without being aggressive",
    ],
    pitfalls: ["Vague hints instead of asks", "Demanding", "Over-apologizing until the point is lost"],
    example: "“I'd love your advice on where to buy fruit at a fair price — would you mind?”",
    rubric: [
      "Demanding, or so vague the other person can't help",
      "Unclear or indirect most of the time",
      "Clear at times, sometimes muddled",
      "Clear, polite, explains the why",
      "Crisp, warm, and confident — easy to say yes to",
    ],
    roots: "Assertiveness training; requests in Nonviolent Communication (Rosenberg)",
  },
  common_ground: {
    id: "common_ground",
    name: "Common Ground",
    icon: "🤝",
    tagline: "Find shared interests and solve together.",
    behaviors: [
      "Notices shared interests or values",
      "Shares a little about yourself when it connects",
      "Looks for options that work for both sides",
    ],
    pitfalls: ["Win-lose bargaining", "Over-sharing", "Arguing positions instead of interests"],
    example: "“We both care about the river staying clean — what would help the fishermen and the visitors?”",
    rubric: [
      "Adversarial or entirely one-sided",
      "Little attempt to connect or collaborate",
      "Some connection, mostly on your terms",
      "Finds shared interests and explores mutual options",
      "Builds a genuine partnership around shared interests",
    ],
    roots: "Interest-based negotiation (Fisher, Ury & Patton); Interests–Rights–Power (Ury, Brett & Goldberg)",
  },
};

export const SKILL_LEVELS = ["Novice", "Apprentice", "Practitioner", "Expert", "Mentor"] as const;

export function skillLevelName(rating: number): (typeof SKILL_LEVELS)[number] {
  if (rating >= 80) return "Mentor";
  if (rating >= 60) return "Expert";
  if (rating >= 40) return "Practitioner";
  if (rating >= 20) return "Apprentice";
  return "Novice";
}

export function isSkillId(value: unknown): value is SkillId {
  return typeof value === "string" && (SKILL_IDS as readonly string[]).includes(value);
}
