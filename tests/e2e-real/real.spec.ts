// The real thing: Google Maps and Street View in the browser, live grounding, the real model the
// server is configured with (Claude or an OpenAI-compatible API), voice through the voice model,
// and a postcard painted through mm-gateway. Voice and postcards run when the server has them.
import { expect, test } from "@playwright/test";
import type { AppConfig } from "../../shared/schemas.ts";
import { onboard, say } from "../e2e/helpers.ts";

const MINUTE = 60_000;
// Thinking models can reason for minutes before they answer: with qwen3.8-max an expedition
// took about 4 minutes and a persona 2–3. Generous budgets keep a slow day from failing the run.
const COMPOSE_TIMEOUT = 10 * MINUTE;

test("a real expedition: Google Maps, live grounding, a real model, voice and a postcard", async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const snap = async (name: string) => testInfo.attach(name, { body: await page.screenshot(), contentType: "image/png" });

  const config = (await (await page.request.get("/api/config")).json()) as AppConfig;
  // Redacted on purpose: the full config carries the browser Maps key.
  await testInfo.attach("config", {
    body: JSON.stringify({ aiMode: config.aiMode, model: config.model, mapsMode: config.mapsMode, placeGrounding: config.placeGrounding, features: config.features }, null, 2),
    contentType: "application/json",
  });
  expect(config.aiMode, "a real model must be configured (AI_PROVIDER, AI_MODEL, AI_API_KEY)").not.toBe("demo");
  expect(config.mapsMode, "Google Maps must be configured (GOOGLE_MAPS_API_KEY)").toBe("google");

  await onboard(page, "Rae");
  await expect(page.getByTestId("map").locator(".gm-style").first(), "the Google map renders").toBeAttached({ timeout: 2 * MINUTE });
  await expect(page.locator(".map-error"), "Google Maps accepts the key on this origin (check the key's HTTP referrer restrictions)").toHaveCount(0);
  await snap("world map");

  if (config.features.voice) {
    // Speak to the locals and hear them: both voice settings on.
    await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /Settings/ }).click();
    await page.getByTestId("voice-input-toggle").check();
    await page.getByTestId("voice-output-toggle").check();
    await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /World/ }).click();
  }

  // The model composes an expedition from live grounding.
  await page.locator(".postcard-row", { hasText: "Kyoto" }).click();
  await page.getByRole("button", { name: "Travel here" }).click();
  // Two-stage arrival: the briefing first, then the locals.
  await expect(page.getByText(/^Say hello in/), "the model writes the briefing").toBeVisible({ timeout: COMPOSE_TIMEOUT });
  await expect(page.locator(".scene")).not.toBeEmpty();
  await snap("briefing");
  await expect(page.locator(".local-card:not(.local-card--pending)").first(), "the model composes the locals").toBeVisible({ timeout: COMPOSE_TIMEOUT });
  await snap("expedition");

  if (config.features.voice) {
    // Pronunciation practice on the greeting: the microphone plays a recorded line, so the score
    // itself doesn't matter here, only that the voice model heard it and answered.
    await page.getByTestId("pronounce-btn").first().click();
    await page.waitForTimeout(3_000);
    await page.getByTestId("pronounce-btn").first().click();
    await expect(page.getByTestId("pronounce-result").first(), "the voice model scores a pronunciation attempt").toBeVisible({ timeout: 2 * MINUTE });
    await snap("pronunciation");
  }

  // …then a local's persona, met where Google has Street View (or a place card where it doesn't).
  const meet = page.locator('[data-testid^="meet-"]').first();
  await expect(meet, "the model creates the local's persona").toBeEnabled({ timeout: COMPOSE_TIMEOUT });
  const opening = config.features.voice ? page.waitForResponse((r) => r.url().endsWith("/api/voice/speak"), { timeout: 2 * MINUTE }) : null;
  await meet.click();
  await expect(page.getByRole("meter", { name: /Rapport/ })).toBeVisible();
  await expect(page.getByText("Finding a street view…")).toHaveCount(0, { timeout: MINUTE });
  if (opening) {
    // The opening line is voiced by the model, or the browser takes over (501: a model that only listens).
    const response = await opening;
    expect([200, 501], `voice for the opening line answered ${response.status()}`).toContain(response.status());
  }
  await snap("encounter");

  if (config.features.voice) {
    // Speak the first message: the voice model transcribes it and says how it sounded.
    await page.getByTestId("mic-btn").click();
    await page.waitForTimeout(6_000);
    await page.getByTestId("mic-btn").click();
    await expect(page.getByTestId("heard"), "the voice model hears the spoken line").toBeVisible({ timeout: 2 * MINUTE });
    const message = page.getByRole("textbox", { name: /Your message/ });
    await expect(message).toHaveValue(/first time|enjoy|work/i);
    await snap("heard");
    await page.getByTestId("send-btn").click();
    await expect(page.locator(".msg--player").last().locator(".delivery"), "the spoken line keeps how it sounded").toBeVisible();
    await expect(page.locator(".msg.is-streaming")).toHaveCount(0, { timeout: 3 * MINUTE });
  } else {
    await say(page, "Hello! It's my first time in Kyoto. What are you working on today?");
  }

  // A short conversation, streamed from the model.
  await expect(page.locator(".msg--npc").last().locator(".bubble")).not.toBeEmpty();
  await say(page, "That sounds like it takes real care. What do you enjoy most about it?");
  await say(page, "Thank you so much for sharing that with me. Take care, goodbye!");
  await snap("conversation");

  // The local may or may not end it on goodbye; either way, reflect and get mentored.
  const end = page.getByRole("button", { name: "End conversation" });
  const rate = page.getByTestId("rate-4");
  await expect(rate.or(end)).toBeVisible();
  if (await end.isVisible()) await end.click();
  await rate.click();
  await page.getByTestId("get-feedback").click();
  const debrief = page.getByTestId("debrief");
  await expect(debrief, "the model writes the mentor debrief").toBeVisible({ timeout: COMPOSE_TIMEOUT });
  await expect(debrief.getByRole("heading", { level: 1 })).not.toBeEmpty();
  await snap("debrief");

  if (config.features.postcards) {
    // A souvenir painted by the image model through mm-gateway.
    await debrief.getByTestId("paint-postcard").click();
    const postcard = debrief.getByTestId("postcard-img");
    await expect(postcard, "the image model paints the postcard").toBeVisible({ timeout: 5 * MINUTE });
    expect(await postcard.evaluate((img: HTMLImageElement) => img.naturalWidth), "the postcard is a real image").toBeGreaterThan(256);
    await postcard.scrollIntoViewIfNeeded();
    await snap("postcard");
  }

  expect(pageErrors, "no uncaught errors in the page").toEqual([]);
});
