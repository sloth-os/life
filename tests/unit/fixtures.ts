// Shared test fixtures: a small but realistic expedition, persona and transcript.
import type { ExpeditionContext, NpcCard, Persona, PlayerContext, TurnRequest } from "../../shared/schemas.ts";
import type { GroundingPack } from "../../server/grounding/index.ts";

export const player: PlayerContext = { name: "Sam", ageBand: "adult", focusSkill: "listening", skills: { curiosity: 30, listening: 20 }, recentScenarios: [] };

export const npc: NpcCard = {
  id: "npc-1",
  name: "Wanjiru",
  age: 40,
  role: "market vendor",
  placeName: "Moi Avenue",
  placeSourceId: "W1",
  location: { lat: -1.283, lng: 36.824 },
  lens: "economy",
  scenario: "conversation",
  difficulty: 1,
  hook: "Taking a breather, people-watching",
  goal: "Learn what a normal day looks like for Wanjiru",
  hue: 210,
};

export const context: ExpeditionContext = {
  expeditionId: "exp_test",
  title: "Nairobi: Street Stories",
  destinationLabel: "Nairobi",
  locality: { city: "Nairobi", country: "Kenya" },
  scene: "It's afternoon in Nairobi.",
  weatherSummary: "27°C, light drizzle",
  greeting: { language: "Swahili", phrase: "Habari", meaning: "Hello — literally “what news?”" },
  notes:
    "[W0] Nairobi: Nairobi is the capital and largest city of Kenya. As of 2019 the city had a population of 4.4 million people.\n[W1] Moi Avenue (Nairobi): Moi Avenue is one of the oldest roads in Nairobi. It is intersected by Kenyatta Avenue and Haile Selassie Avenue.",
  sources: [
    { id: "W0", title: "Nairobi", kind: "wikipedia" },
    { id: "W1", title: "Moi Avenue (Nairobi)", kind: "wikipedia" },
  ],
};

export const persona: Persona = {
  npcId: "npc-1",
  name: "Wanjiru",
  age: 40,
  role: "market vendor",
  pronouns: "she/her",
  placeName: "Moi Avenue",
  personality: "Quick and sociable.",
  communicationStyle: "Chatty, quick jokes.",
  background: "Has sold fruit on Moi Avenue for twelve years.",
  currentSituation: "Taking a short break between customers.",
  hiddenConcern: "Rising rents may close her stall.",
  boundaries: ["Being photographed without asking"],
  languageNotes: "Speaks Swahili and English.",
  scenarioBrief: "Happy to chat if the visitor is genuinely curious.",
  openingLine: "Oh, hello! First time around here?",
  openingGesture: "straightens a row of mangoes",
  startingRapport: 22,
  insights: [
    { id: "i1", lens: "economy", title: "Moi Avenue", fact: "Moi Avenue is one of the oldest roads in Nairobi.", threshold: 30, sourceIds: ["W1"], quiz: { question: "Q1", options: ["a", "b"], answerIndex: 0 } },
    { id: "i2", lens: "history", title: "A big city", fact: "Nairobi is the capital of Kenya.", threshold: 55, sourceIds: ["W0"], quiz: { question: "Q2", options: ["a", "b"], answerIndex: 1 } },
    { id: "i3", lens: "society", title: "People", fact: "As of 2019 the city had 4.4 million people.", threshold: 75, sourceIds: ["W0"], quiz: { question: "Q3", options: ["a", "b"], answerIndex: 0 } },
  ],
};

export function turnRequest(overrides: Partial<TurnRequest> = {}): TurnRequest {
  return {
    context,
    npc,
    persona,
    player,
    transcript: [{ speaker: "npc", text: persona.openingLine, gesture: persona.openingGesture, emotion: "curious", rapportDelta: 0, rapportAfter: 22, revealedInsightIds: [] }],
    rapport: 22,
    unlockedInsightIds: [],
    playerMessage: "Habari! What are you working on today?",
    ...overrides,
  };
}

export const pack: GroundingPack = {
  mapsMode: "open",
  center: { lat: -1.2841, lng: 36.8235 },
  label: "Nairobi",
  locality: { city: "Nairobi", country: "Kenya" },
  localTime: "Thursday 14:05 (afternoon)",
  weather: { summary: "27°C, light drizzle", tempC: 27, condition: "light drizzle", isDay: true, provider: "open-meteo", attribution: "Weather data by Open-Meteo.com (CC BY 4.0)" },
  lensSummaries: [],
  places: [
    { sourceId: "W1", kind: "wikipedia", name: "Moi Avenue", location: { lat: -1.283, lng: 36.824 } },
    { sourceId: "W2", kind: "wikipedia", name: "Jamia Mosque", location: { lat: -1.2835, lng: 36.8228 } },
  ],
  articles: [
    { sourceId: "W0", title: "Nairobi", extract: "Nairobi is the capital and largest city of Kenya. As of 2019 the city had a population of 4.4 million people.", url: "https://en.wikipedia.org/wiki/Nairobi" },
    { sourceId: "W1", title: "Moi Avenue (Nairobi)", extract: "Moi Avenue is one of the oldest roads in Nairobi. It is intersected by Kenyatta Avenue.", url: "https://en.wikipedia.org/wiki/Moi_Avenue_(Nairobi)", distanceM: 120 },
    { sourceId: "W2", title: "Jamia Mosque (Kenya)", extract: "The Jamia Mosque is a Sunni mosque in Nairobi, built between 1925 and 1933 through a community fundraising effort.", url: "https://en.wikipedia.org/wiki/Jamia_Mosque_(Kenya)", distanceM: 300 },
  ],
  sources: [
    { id: "W0", kind: "wikipedia", title: "Nairobi", url: "https://en.wikipedia.org/wiki/Nairobi", attribution: "Wikipedia (CC BY-SA 4.0)" },
    { id: "W1", kind: "wikipedia", title: "Moi Avenue (Nairobi)", url: "https://en.wikipedia.org/wiki/Moi_Avenue_(Nairobi)", attribution: "Wikipedia (CC BY-SA 4.0)" },
    { id: "W2", kind: "wikipedia", title: "Jamia Mosque (Kenya)", url: "https://en.wikipedia.org/wiki/Jamia_Mosque_(Kenya)", attribution: "Wikipedia (CC BY-SA 4.0)" },
    { id: "WX", kind: "weather", title: "Current weather: 27°C, light drizzle", attribution: "Weather data by Open-Meteo.com (CC BY 4.0)" },
  ],
};
