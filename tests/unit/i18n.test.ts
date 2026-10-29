// Interface localization: every language covers every key (the type checker enforces that);
// these check interpolation, translated game vocabulary, and the AI's language instruction.
import { afterEach, describe, expect, it } from "vitest";
import { POSTCARDS } from "../../shared/destinations.ts";
import { languageRule } from "../../shared/languages.ts";
import { renderPlayer } from "../../server/ai/prompts.ts";
import { LANGS, levelName, moveText, placeName, plural, postcardText, setLang, skillName, t, tierName } from "../../src/i18n/index.ts";
import { en } from "../../src/i18n/en.ts";
import { es } from "../../src/i18n/es.ts";
import { zh } from "../../src/i18n/zh.ts";
import { player } from "./fixtures.ts";

afterEach(() => setLang("en"));

describe("i18n", () => {
  it("fills placeholders and picks plural forms", () => {
    expect(t("world.whereNext", { name: "Sam" })).toBe("Where to next, Sam?");
    expect(plural(1, "journal.visitOne", "journal.visits")).toBe("1 visit");
    expect(plural(3, "journal.visitOne", "journal.visits")).toBe("3 visits");
    setLang("zh");
    expect(t("world.whereNext", { name: "小林" })).toBe("小林，下一站去哪儿？");
    setLang("es");
    expect(t("composer.turns", { turns: 2, cap: 12 })).toBe("2 de ~12 turnos");
  });

  it("keeps every translation's placeholders the same as English", () => {
    for (const translation of [es, zh]) {
      for (const [key, english] of Object.entries(en)) {
        const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
        expect(names(translation.ui[key as keyof typeof en]), key).toEqual(names(english));
      }
    }
  });

  it("translates game vocabulary and place names by id", () => {
    setLang("es");
    expect(skillName("common_ground")).toBe("Terreno común");
    expect(moveText("open_question").label).toBe("pregunta abierta");
    expect(levelName("Expert")).toBe("Experto");
    setLang("zh");
    expect(tierName("Trusted")).toBe("信任");
    const kyoto = POSTCARDS.find((p) => p.id === "kyoto")!;
    expect(postcardText(kyoto).name).toBe("京都");
    expect(placeName({ label: "Kyoto", postcardId: "kyoto" })).toBe("京都");
    expect(placeName({ label: "A pin by the river" })).toBe("A pin by the river");
    for (const lang of LANGS) {
      setLang(lang);
      for (const p of POSTCARDS) expect(postcardText(p).theme.length, `${lang}:${p.id}`).toBeGreaterThan(0);
    }
  });

  it("tells the model to write in the player's language", () => {
    expect(languageRule("en")).toBe("");
    expect(languageRule(undefined)).toBe("");
    expect(renderPlayer({ ...player, language: "zh" })).toContain("Write every player-facing string");
    expect(renderPlayer({ ...player, language: "zh" })).toContain("Simplified Chinese (简体中文)");
    expect(renderPlayer({ ...player, language: "en" })).not.toContain("Language:");
  });
});
