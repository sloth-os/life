import { describe, expect, it } from "vitest";
import { extractPartialString } from "../../server/ai/partialJson.ts";

describe("extractPartialString", () => {
  it("returns null until the key appears", () => {
    expect(extractPartialString("", "reply")).toBeNull();
    expect(extractPartialString('{"rep', "reply")).toBeNull();
    expect(extractPartialString('{"reply":', "reply")).toBeNull();
  });

  it("streams a value as it grows", () => {
    const prefix = '{"reply":"';
    const full = `${prefix}Hello there, friend","emotion":"warm"}`;
    const at = (n: number) => extractPartialString(full.slice(0, prefix.length + n), "reply");
    expect(extractPartialString(full.slice(0, prefix.length - 2), "reply")).toBeNull();
    expect([at(0), at(3), at(11), at(19), at(full.length)]).toEqual(["", "Hel", "Hello there", "Hello there, friend", "Hello there, friend"]);
  });

  it("decodes escapes, including unicode, and waits on incomplete ones", () => {
    const json = '{"reply":"She said \\"karibu\\"\\nthen \\u00e9t\\u00e9 \\ud83d\\ude00"}';
    expect(extractPartialString(json, "reply")).toBe('She said "karibu"\nthen été 😀');
    expect(extractPartialString('{"reply":"wait \\', "reply")).toBe("wait ");
    expect(extractPartialString('{"reply":"caf\\u00e', "reply")).toBe("caf");
  });

  it("tolerates whitespace around the colon", () => {
    expect(extractPartialString('{ "reply" :  "hi"', "reply")).toBe("hi");
  });
});
