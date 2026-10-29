// The languages the game speaks: its interface, and what the AI writes in for the player.
export const LANGS = ["en", "es", "zh"] as const;
export type Lang = (typeof LANGS)[number];

/** How the language is named to the model. */
export const LANGUAGE_FOR_AI: Record<Lang, string> = { en: "English", es: "Spanish (español)", zh: "Simplified Chinese (简体中文)" };

/** For Google Maps (agent tools' language_code). */
export const MAPS_LANGUAGE_CODE: Record<Lang, string> = { en: "en", es: "es", zh: "zh_CN" };

/** The instruction every prompt carries when the player isn't playing in English. */
export function languageRule(lang: Lang | undefined): string {
  if (!lang || lang === "en") return "";
  const name = LANGUAGE_FOR_AI[lang];
  return `Language: the player plays in ${name}. Write every player-facing string (titles, scenes, dialogue, insights, quiz questions, hints and feedback) in ${name}. Greetings and local phrases stay in the local language, with their meanings in ${name}. Quotes of the player's own words stay exactly as they wrote them.`;
}
