// Text resources for the scripted Demo engine. Demo content is clearly
// labelled in the UI; names and greetings are a small, deliberately varied set.
import type { LensId, ScenarioId } from "../../shared/world.ts";
import type { SkillId } from "../../shared/skills.ts";

export interface DemoGreeting {
  language: string;
  phrase: string;
  meaning: string;
  pronunciation: string;
}

const spanish: DemoGreeting = { language: "Spanish", phrase: "Hola", meaning: "Hello", pronunciation: "OH-lah" };
const english: DemoGreeting = { language: "English", phrase: "How's it going?", meaning: "A casual hello", pronunciation: "" };

export const GREETINGS: Record<string, DemoGreeting> = {
  Kenya: { language: "Swahili", phrase: "Habari", meaning: "Hello — literally “what news?”", pronunciation: "ha-BAH-ree" },
  Tanzania: { language: "Swahili", phrase: "Habari", meaning: "Hello — literally “what news?”", pronunciation: "ha-BAH-ree" },
  Ghana: { language: "Twi", phrase: "Ɛte sɛn?", meaning: "How are you?", pronunciation: "eh-teh SEN" },
  Morocco: { language: "Darija (Moroccan Arabic)", phrase: "Salam", meaning: "Peace — an everyday hello", pronunciation: "sah-LAHM" },
  Japan: { language: "Japanese", phrase: "Konnichiwa", meaning: "Hello / good afternoon", pronunciation: "kon-NEE-chee-wah" },
  India: { language: "Hindi", phrase: "Namaste", meaning: "A respectful hello", pronunciation: "NUH-muh-stay" },
  Vietnam: { language: "Vietnamese", phrase: "Xin chào", meaning: "Hello", pronunciation: "sin chow" },
  Mongolia: { language: "Mongolian", phrase: "Sain baina uu?", meaning: "Hello — “are you well?”", pronunciation: "sain BAIN-oo" },
  Türkiye: { language: "Turkish", phrase: "Merhaba", meaning: "Hello", pronunciation: "MEHR-hah-bah" },
  Turkey: { language: "Turkish", phrase: "Merhaba", meaning: "Hello", pronunciation: "MEHR-hah-bah" },
  Iceland: { language: "Icelandic", phrase: "Góðan daginn", meaning: "Good day", pronunciation: "GOH-than DIE-in" },
  Netherlands: { language: "Dutch", phrase: "Goedemorgen", meaning: "Good morning", pronunciation: "HKHOO-duh-mor-khun" },
  Mexico: { language: "Spanish", phrase: "Buenos días", meaning: "Good morning", pronunciation: "BWEH-nos DEE-as" },
  Peru: { language: "Quechua", phrase: "Allillanchu?", meaning: "Are you well? — a warm hello", pronunciation: "ah-yee-YAHN-choo" },
  Brazil: { language: "Portuguese", phrase: "Bom dia", meaning: "Good morning", pronunciation: "bohn JEE-ah" },
  Portugal: { language: "Portuguese", phrase: "Bom dia", meaning: "Good morning", pronunciation: "bohn DEE-ah" },
  "New Zealand": { language: "Māori", phrase: "Kia ora", meaning: "Hello — “be well”", pronunciation: "kee-ah OH-rah" },
  France: { language: "French", phrase: "Bonjour", meaning: "Hello / good day", pronunciation: "bohn-ZHOOR" },
  Germany: { language: "German", phrase: "Guten Tag", meaning: "Good day", pronunciation: "GOO-ten tahk" },
  Austria: { language: "German", phrase: "Grüß Gott", meaning: "Hello (southern German greeting)", pronunciation: "groos got" },
  Italy: { language: "Italian", phrase: "Buongiorno", meaning: "Good morning", pronunciation: "bwon-JOR-no" },
  Spain: spanish,
  Argentina: spanish,
  Chile: spanish,
  Colombia: spanish,
  China: { language: "Mandarin", phrase: "Nǐ hǎo", meaning: "Hello", pronunciation: "nee how" },
  "South Korea": { language: "Korean", phrase: "Annyeonghaseyo", meaning: "Hello (polite)", pronunciation: "ahn-nyong-ha-SAY-yo" },
  Thailand: { language: "Thai", phrase: "Sawasdee", meaning: "Hello", pronunciation: "sa-wat-DEE" },
  Indonesia: { language: "Indonesian", phrase: "Selamat pagi", meaning: "Good morning", pronunciation: "suh-LAH-mat PAH-gee" },
  Egypt: { language: "Egyptian Arabic", phrase: "Ahlan", meaning: "Hello / welcome", pronunciation: "AH-lan" },
  Nigeria: { language: "Yoruba", phrase: "Báwo ni?", meaning: "How are you?", pronunciation: "BAH-woh nee" },
  "South Africa": { language: "Zulu", phrase: "Sawubona", meaning: "Hello — “I see you”", pronunciation: "sah-woo-BOH-nah" },
  Ethiopia: { language: "Amharic", phrase: "Selam", meaning: "Peace / hello", pronunciation: "seh-LAHM" },
  Greece: { language: "Greek", phrase: "Yia sou", meaning: "Hello — “health to you”", pronunciation: "YAH-soo" },
  Philippines: { language: "Filipino", phrase: "Kumusta", meaning: "How are you?", pronunciation: "koo-MOOS-tah" },
  "United States": english,
  "United Kingdom": english,
  Canada: english,
  Australia: english,
  Ireland: english,
};

export const FALLBACK_GREETING: DemoGreeting = {
  language: "the local language",
  phrase: "Hello",
  meaning: "Ask a local how they greet each other here!",
  pronunciation: "",
};

type NamePool = [string, "she/her" | "he/him"][];

export const NAMES: Record<string, NamePool> = {
  Kenya: [["Wanjiru", "she/her"], ["Otieno", "he/him"], ["Achieng", "she/her"], ["Kamau", "he/him"], ["Njeri", "she/her"], ["Mwangi", "he/him"]],
  Ghana: [["Ama", "she/her"], ["Kwame", "he/him"], ["Akosua", "she/her"], ["Kofi", "he/him"], ["Efua", "she/her"], ["Yaw", "he/him"]],
  Morocco: [["Khadija", "she/her"], ["Youssef", "he/him"], ["Salma", "she/her"], ["Hamza", "he/him"], ["Fatima Zahra", "she/her"], ["Rachid", "he/him"]],
  Japan: [["Haruka", "she/her"], ["Kenji", "he/him"], ["Yui", "she/her"], ["Takeshi", "he/him"], ["Aiko", "she/her"], ["Sota", "he/him"]],
  India: [["Priya", "she/her"], ["Arjun", "he/him"], ["Meera", "she/her"], ["Rohit", "he/him"], ["Kavita", "she/her"], ["Sanjay", "he/him"]],
  Vietnam: [["Linh", "she/her"], ["Minh", "he/him"], ["Thu", "she/her"], ["Đức", "he/him"], ["Hoa", "she/her"], ["Quang", "he/him"]],
  Mongolia: [["Oyuna", "she/her"], ["Bat-Erdene", "he/him"], ["Saraa", "she/her"], ["Ganbold", "he/him"], ["Naraa", "she/her"], ["Tuvshin", "he/him"]],
  Türkiye: [["Elif", "she/her"], ["Mehmet", "he/him"], ["Zeynep", "she/her"], ["Emre", "he/him"], ["Ayşe", "she/her"], ["Burak", "he/him"]],
  Iceland: [["Sigrún", "she/her"], ["Jón", "he/him"], ["Katrín", "she/her"], ["Gunnar", "he/him"], ["Helga", "she/her"], ["Einar", "he/him"]],
  Netherlands: [["Sanne", "she/her"], ["Daan", "he/him"], ["Fleur", "she/her"], ["Joris", "he/him"], ["Anouk", "she/her"], ["Bram", "he/him"]],
  Mexico: [["Guadalupe", "she/her"], ["Mateo", "he/him"], ["Ximena", "she/her"], ["Javier", "he/him"], ["Rosa", "she/her"], ["Diego", "he/him"]],
  "United States": [["Tasha", "she/her"], ["Marcus", "he/him"], ["Jenny", "she/her"], ["Luis", "he/him"], ["Carla", "she/her"], ["Mike", "he/him"]],
  Peru: [["Nayeli", "she/her"], ["Wilber", "he/him"], ["Yaneth", "she/her"], ["Fredy", "he/him"], ["Rosa", "she/her"], ["Julio", "he/him"]],
  Brazil: [["Ana Clara", "she/her"], ["João", "he/him"], ["Rayssa", "she/her"], ["Thiago", "he/him"], ["Luana", "she/her"], ["Marcos", "he/him"]],
  "New Zealand": [["Aroha", "she/her"], ["Tama", "he/him"], ["Mere", "she/her"], ["Wiremu", "he/him"], ["Sarah", "she/her"], ["Liam", "he/him"]],
};

export const GLOBAL_NAMES: NamePool = [
  ["Nadia", "she/her"],
  ["Sam", "he/him"],
  ["Mira", "she/her"],
  ["Omar", "he/him"],
  ["Ines", "she/her"],
  ["Kai", "he/him"],
  ["Zara", "she/her"],
  ["Tomas", "he/him"],
];

export const ROLES: Record<LensId, string[]> = {
  nature: ["park ranger", "community gardener", "fisher", "birdwatching guide", "tree nursery worker"],
  culture: ["cook at a family eatery", "musician", "textile artist", "dance teacher", "temple volunteer"],
  history: ["retired history teacher", "museum guide", "second-hand bookseller", "walking-tour guide"],
  society: ["school teacher", "nurse", "community organizer", "bus driver", "librarian"],
  economy: ["market vendor", "tailor", "taxi driver", "café owner", "street food cook", "mechanic"],
};

export const SCENARIO_TEMPLATES: Record<ScenarioId, { situation: string; goal: string; brief: string; hook: string }> = {
  conversation: {
    situation: "taking a short break and watching the street go by",
    goal: "Learn what a normal day looks like for {name}",
    brief: "Happy to chat if the visitor is genuinely curious; bored by generic tourist questions.",
    hook: "Taking a breather, people-watching with a cup in hand",
  },
  ask_help: {
    situation: "busy, but the kind of person who helps when asked clearly and kindly",
    goal: "Ask {name} for advice on getting around {city} like a local",
    brief: "Will help a polite visitor who explains what they need; dislikes vague or demanding requests.",
    hook: "Knows the area well, but is clearly in the middle of something",
  },
  support: {
    situation: "a bit down after a long, frustrating morning",
    goal: "Find out what's weighing on {name} and be there for them",
    brief: "Wants to be heard, not fixed; opens up if the visitor notices their mood and listens.",
    hook: "Sighs a lot today; seems to have something on their mind",
  },
  negotiate: {
    situation: "running the stall, used to visitors haggling hard",
    goal: "Agree on a price for something you'd like to buy that's fair to you both",
    brief: "Needs a fair margin to support their family; respects clear offers and dislikes insulting lowballs.",
    hook: "Arranging goods with care; prices aren't marked",
  },
  perspective: {
    situation: "annoyed about recent changes in the neighbourhood",
    goal: "Understand how {name} sees the changes in {city}",
    brief: "Has strong views about local change; softens if the visitor listens before arguing.",
    hook: "Frowning at a new sign across the street",
  },
  tradition: {
    situation: "preparing for a small local custom",
    goal: "Learn about a local custom and take part respectfully",
    brief: "Proud to share the custom with a respectful visitor; put off by people treating it as a spectacle.",
    hook: "Getting something ready with practised, careful hands",
  },
  collaborate: {
    situation: "trying to finish a task that really needs an extra pair of hands",
    goal: "Help {name} finish their task by working together",
    brief: "Would welcome help if the visitor offers clearly and follows their lead.",
    hook: "Struggling to finish a job alone",
  },
};

export const SCENARIOS_FOR_SKILL: Record<SkillId, ScenarioId[]> = {
  curiosity: ["conversation", "tradition"],
  listening: ["conversation", "support"],
  empathy: ["support", "perspective"],
  respect: ["tradition", "perspective"],
  clarity: ["ask_help", "negotiate"],
  common_ground: ["collaborate", "negotiate"],
};

export const FIELD_MISSIONS: Record<SkillId, { title: string; description: string }> = {
  curiosity: { title: "Three open questions", description: "In a conversation this week, ask three “what” or “how” questions in a row — and follow up on one answer." },
  listening: { title: "Say it back", description: "Next time someone tells you about their day, paraphrase one thing they said before adding anything of your own." },
  empathy: { title: "Name the feeling", description: "When a friend or colleague sounds stressed, try naming it gently: “that sounds exhausting.” Notice how they respond." },
  respect: { title: "Ask, don't assume", description: "Ask someone from a different background how they celebrate a holiday or a special day — and just listen." },
  clarity: { title: "One clear ask", description: "Make one request this week in a single sentence, with the reason: “Could you…? It would help because…”" },
  common_ground: { title: "Find the overlap", description: "In your next disagreement, say out loud one thing you both want before discussing what you disagree on." },
};

export const REFLECTION_QUESTIONS: Record<SkillId, string> = {
  curiosity: "When you're curious about someone, what stops you from asking a follow-up question?",
  listening: "In everyday conversations, how often do you reflect back what someone said before replying?",
  empathy: "When someone shares something hard, what's your first instinct — to fix it, or to understand it?",
  respect: "What assumptions did you bring to this place, and where did they come from?",
  clarity: "Where in your life do you hint at what you need instead of asking directly?",
  common_ground: "Think of someone you disagree with: what might you both want underneath the disagreement?",
};

// ── Mediation scenes (Demo AI) ─────────────────────────────────────────────
interface SceneSide {
  role: string;
  position: string;
  interest: string;
  temperament: string;
  /** Lines by mood: defensive while tense, opening up once heard, warm once it settles. */
  defensive: string[];
  opening: string;
  warm: string;
}

export interface SceneTemplate {
  title: string;
  topic: string;
  place: string;
  situation: string;
  shared: string;
  a: SceneSide;
  b: SceneSide;
  start: [string, string];
  agreement: string;
  /** How the second one accepts, in their own words. */
  accept: string;
}

export const SCENE_TEMPLATES: SceneTemplate[] = [
  {
    title: "Tables on the pavement",
    topic: "a café's tables on the shared pavement",
    place: "the corner café",
    situation: "Outside a small café, chairs scrape as two neighbours argue over a stretch of pavement. A pram is parked half in the road.",
    shared: "Both want the street safe and lively; neither wants it to empty out.",
    a: {
      role: "café owner",
      position: "My tables need the pavement in the evenings; that's when I make my money.",
      interest: "Rent went up and the evening trade is what keeps the café open.",
      temperament: "Quick and proud, warms up when someone takes the business seriously.",
      defensive: ["I've had these tables here for years. Nobody complained before.", "So I should just close early? Who pays my rent then?"],
      opening: "Honestly? Since the rent went up, the evenings are all that keeps us going.",
      warm: "I don't want anyone walking in the road. That's not the street I want either.",
    },
    b: {
      role: "neighbour with a young daughter",
      position: "I can't get past with the pram. The pavement is for everyone.",
      interest: "A scooter nearly hit her and her daughter when she had to walk in the road.",
      temperament: "Tired and blunt, softens when someone asks about her daughter.",
      defensive: ["Every evening I end up in the road with a pram. Every evening.", "It's not about your money, it's about getting home safely."],
      opening: "Last month a scooter nearly hit us when I had to go round the tables. I still think about it.",
      warm: "I like the café, really. I just need a way through.",
    },
    start: ["Those tables have been there for years! Nobody complained before.", "Because nobody could get through to complain! I had to walk in the road again."],
    agreement: "The café keeps its tables but leaves a clear lane by the wall, and moves two of them in after six.",
    accept: "A clear lane by the wall, and two tables in after six? All right. I can live with that.",
  },
  {
    title: "Practice after dark",
    topic: "late-night band practice above the bakery",
    place: "the bakery on the square",
    situation: "By the bakery door a young musician with a guitar case and the baker in a flour-dusted apron are talking over each other.",
    shared: "Both care about the neighbourhood: one wants a place to make music, the other a place to work and rest.",
    a: {
      role: "musician who rents the room upstairs",
      position: "We only practise until eleven. That's allowed.",
      interest: "The band has a first paid gig in two weeks, and this room is the only one they can afford.",
      temperament: "Defensive, then eager once someone notices how much the gig matters.",
      defensive: ["Eleven isn't late! It's allowed.", "Where else are we supposed to go? Studios cost a fortune."],
      opening: "We've got our first real gig in two weeks. If we don't practise, we blow it.",
      warm: "I didn't know you start at four. That's brutal.",
    },
    b: {
      role: "baker",
      position: "I start at four in the morning. I need to sleep by nine.",
      interest: "She's run the bakery alone since her husband fell ill and is exhausted.",
      temperament: "Sharp when tired, generous once she feels understood.",
      defensive: ["Allowed or not, I'm the one up at four.", "I've been here twenty years. The bread doesn't bake itself."],
      opening: "Since my husband got sick it's just me. If I don't sleep, I can't stand at the oven.",
      warm: "A first gig, eh? Good for you. I just need my nights.",
    },
    start: ["We stop at eleven! That's the rule.", "And I get up at four! Whose rule covers that?"],
    agreement: "The band practises on the two evenings the bakery is closed the next morning, and stops at nine on other nights.",
    accept: "Loud on my two days off, quiet by nine the rest? Deal. And come and buy bread for the gig.",
  },
  {
    title: "The shady spot",
    topic: "who gets the shaded spot at the market",
    place: "the market square",
    situation: "Under the only tree in the market square, two stallholders have set up half on top of each other, and neither is backing down.",
    shared: "Both want customers to linger, and the shade helps everyone's trade.",
    a: {
      role: "fruit seller",
      position: "My fruit spoils in the sun. I need the shade.",
      interest: "Last summer he lost a week's stock to the heat and still owes his supplier.",
      temperament: "Loud but fair, likes a practical fix.",
      defensive: ["Fruit doesn't survive the sun. Phones do.", "I was here first this morning!"],
      opening: "Last summer I lost a whole week of mangoes to the heat. I'm still paying for it.",
      warm: "Fine, fine. Your screen does go dark in the sun.",
    },
    b: {
      role: "phone-repair stall owner",
      position: "Nobody can see a phone screen in the sun. I need the shade too.",
      interest: "She saved for a year to start the stall and can't afford a slow season.",
      temperament: "Quietly stubborn, opens up when treated as a real business.",
      defensive: ["My customers can't see their screens out there.", "You always say you were first."],
      opening: "I saved for a year for this stall. If nobody stops, I can't make the payments.",
      warm: "Your fruit does make people stop. They look at the phones after.",
    },
    start: ["Move your table, this is my spot!", "It's nobody's spot. It's the only shade there is!"],
    agreement: "They put up a shared awning between the two stalls and split its cost.",
    accept: "One awning over both stalls, and we split the cost? Yes. We can try that.",
  },
];
