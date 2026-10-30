// Voice mode against a stand-in voice model (tests/e2e/fakeVoice.ts), with Chromium's fake
// microphone: practise a greeting, speak to a local (the heard words fill the message box before
// the notes on how it sounded), and send the line with its delivery.
import { expect, test } from "@playwright/test";
import { FAKE_HEARD } from "./fakeVoice.ts";
import { onboard, travelToNairobi } from "./helpers.ts";

test("voice: practise the greeting, speak to a local, send the line with how it sounded", async ({ page }) => {
  // Two recordings and their audio decoding: slower than the typed journeys on a busy runner.
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await onboard(page, "Vo");
  const nav = page.getByRole("navigation", { name: "Main" });
  await nav.getByRole("button", { name: /Settings/ }).click();
  await page.getByTestId("voice-input-toggle").check();
  await nav.getByRole("button", { name: /World/ }).click();
  await travelToNairobi(page);

  // Pronunciation practice on the greeting.
  const practise = page.getByTestId("pronounce-btn").first();
  await practise.click();
  await page.waitForTimeout(1_000);
  await practise.click();
  await expect(page.getByTestId("pronounce-result").first()).toContainText("84/100");

  await page.getByTestId("meet-npc-1").click();
  await expect(page.getByRole("meter", { name: /Rapport/ })).toBeVisible();
  const box = page.getByRole("textbox", { name: /Your message/ });
  const words: string[] = [];
  await page.exposeFunction("recordBox", (value: string) => words.push(value));
  // Every value the box shows while the model listens.
  await box.evaluate((el: HTMLTextAreaElement) => {
    let last = "";
    setInterval(() => {
      if (el.value !== last) (window as unknown as { recordBox: (v: string) => void }).recordBox((last = el.value));
    }, 5);
  });
  await page.getByTestId("mic-btn").click();
  await page.waitForTimeout(1_200);
  await page.getByTestId("mic-btn").click();
  await expect(box).toHaveValue(FAKE_HEARD);
  await expect(page.getByTestId("heard")).toContainText("You sounded warm");
  // The words arrived in pieces, before the whole line.
  expect(words.filter((w) => w && w !== FAKE_HEARD && FAKE_HEARD.startsWith(w)).length, "the transcript streamed in").toBeGreaterThan(0);

  await page.getByTestId("send-btn").click();
  await expect(page.locator(".msg--player").last().locator(".delivery")).toContainText("Spoken");
  await expect(page.locator(".msg.is-streaming")).toHaveCount(0);
  expect(errors).toEqual([]);
});
