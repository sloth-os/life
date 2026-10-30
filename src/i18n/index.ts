// Interface localization. UI strings live in typed dictionaries (en is the source; the others must
// cover every key or the build fails). Game vocabulary (skills, moves, places…) is translated by id;
// English comes straight from the shared definitions the AI prompts use, so the two never drift.
import type { Postcard } from "../../shared/destinations.ts";
import { POSTCARDS } from "../../shared/destinations.ts";
import { englishDomain } from "./english.ts";
import type { RapportTier } from "../../shared/rules.ts";
import type { SKILL_LEVELS, SkillId } from "../../shared/skills.ts";
import type { EmotionId, LensId, MoveId, ScenarioId } from "../../shared/world.ts";
import { en, type MessageKey } from "./en.ts";
import { es } from "./es.ts";
import { fr } from "./fr.ts";
import { ja } from "./ja.ts";
import { pt } from "./pt.ts";
import { zh } from "./zh.ts";

export { LANGS, type Lang } from "../../shared/languages.ts";
import { LANGS, type Lang } from "../../shared/languages.ts";
export const LANG_NAMES: Record<Lang, string> = { en: "English", es: "Español", zh: "简体中文", fr: "Français", pt: "Português (Brasil)", ja: "日本語" };
/** BCP 47 tags, for <html lang>, speech and dates. */
export const LANG_TAGS: Record<Lang, string> = { en: "en", es: "es", zh: "zh-CN", fr: "fr", pt: "pt-BR", ja: "ja" };

export interface SkillText {
  name: string;
  tagline: string;
  behaviors: string[];
  pitfalls: string[];
  example: string;
  /** What each score 0–4 looks like. */
  rubric: string[];
}

export interface DomainText {
  skills: Record<SkillId, SkillText>;
  lenses: Record<LensId, string>;
  moves: Record<MoveId, { label: string; description: string }>;
  emotions: Record<EmotionId, string>;
  scenarios: Record<ScenarioId, string>;
  /** By the English rank name. */
  ranks: Record<string, string>;
  levels: Record<(typeof SKILL_LEVELS)[number], string>;
  tiers: Record<RapportTier, string>;
  continents: Record<Postcard["continent"], string>;
  /** Postcards by id: city, country and theme. */
  postcards: Record<string, { name: string; country: string; theme: string }>;
  /** XP parts, by their English label. */
  xp: Record<string, string>;
}

export interface Translation {
  ui: Record<MessageKey, string>;
  domain: DomainText;
}

const TRANSLATIONS: Record<Lang, Translation> = { en: { ui: en, domain: englishDomain() }, es, zh, fr, pt, ja };

let current: Lang = "en";

/** The browser's language, if the game speaks it. */
export function detectLang(): Lang {
  const tag = (typeof navigator === "undefined" ? "en" : navigator.language || "en").toLowerCase();
  const spoken = LANGS.find((l) => tag === l || tag.startsWith(`${l}-`));
  return spoken ?? "en";
}

export function setLang(lang: Lang): void {
  current = lang;
  if (typeof document !== "undefined") document.documentElement.lang = LANG_TAGS[lang];
}

export const lang = (): Lang => current;

/** A UI string, with {placeholders} filled in. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const template = TRANSLATIONS[current].ui[key] ?? en[key];
  return params ? template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match)) : template;
}

/** "one"/"other" plural pick for counts (Chinese and Japanese have one form, so both keys say the same). */
export function plural(count: number, one: MessageKey, other: MessageKey, params: Record<string, string | number> = {}): string {
  return t(count === 1 ? one : other, { count, ...params });
}

const domain = () => TRANSLATIONS[current].domain;
export const skillText = (id: SkillId): SkillText => domain().skills[id];
export const skillName = (id: SkillId): string => domain().skills[id].name;
export const skillRubric = (id: SkillId): string[] => domain().skills[id].rubric;
export const lensName = (id: LensId): string => domain().lenses[id];
export const moveText = (id: MoveId) => domain().moves[id];
export const emotionLabel = (id: EmotionId): string => domain().emotions[id];
export const scenarioName = (id: ScenarioId): string => domain().scenarios[id];
export const rankName = (english: string): string => domain().ranks[english] ?? english;
export const levelName = (english: string): string => domain().levels[english as (typeof SKILL_LEVELS)[number]] ?? english;
export const tierName = (tier: RapportTier): string => domain().tiers[tier] ?? tier;
export const continentName = (c: Postcard["continent"]): string => domain().continents[c] ?? c;
export const xpLabel = (english: string): string => domain().xp[english] ?? english;
export const postcardText = (p: Postcard) => domain().postcards[p.id] ?? { name: p.name, country: p.country, theme: p.theme };

/** A destination's name for display: a postcard's localized name, else the label the player chose. */
export function placeName(destination: { label: string; postcardId?: string }): string {
  const postcard = destination.postcardId ? POSTCARDS.find((p) => p.id === destination.postcardId) : undefined;
  return postcard ? postcardText(postcard).name : destination.label;
}

export type { MessageKey };
