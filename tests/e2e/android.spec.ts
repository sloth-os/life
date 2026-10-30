// Mobile end-to-end: the full journey in Chromium on a real Android device (redroid), at phone
// and tablet sizes. Touch is real touch; layout is the browser's own, not desktop emulation.
import { expect, test, type AndroidDevice, type Page } from "@playwright/test";
import { PROFILES, allowFakeMicrophone, appUrlForDevice, connectDevice, deviceDiagnostics, launchBrowser, resetDisplay, setDisplay } from "./android-device.ts";
import { FAKE_HEARD } from "./fakeVoice.ts";
import { fitsViewportWidth, onboard, say, travelToNairobi } from "./helpers.ts";

const E2E_PORT = 8790;

test.describe.configure({ mode: "serial" });

let device: AndroidDevice;

test.beforeAll(async () => {
  device = await connectDevice();
});

test.afterAll(async () => {
  if (!device) return;
  await resetDisplay(device).catch(() => {});
  await device.close();
});

test.afterEach(async ({}, testInfo) => {
  if (device && testInfo.status !== testInfo.expectedStatus) {
    await testInfo.attach("android-diagnostics", { body: await deviceDiagnostics(device).catch((e: unknown) => String(e)), contentType: "text/plain" });
  }
});

async function bottomOf(page: Page, testId: string): Promise<number> {
  const box = await page.getByTestId(testId).boundingBox();
  expect(box, `${testId} should be on screen`).not.toBeNull();
  return box!.y + box!.height;
}

for (const profile of PROFILES) {
  test(`full journey on a real Android ${profile.name}`, async ({}, testInfo) => {
    const appUrl = appUrlForDevice(E2E_PORT);
    await setDisplay(device, profile);
    const context = await launchBrowser(device, appUrl);
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));

      // A fresh game for each profile: the browser profile persists between launches. Clear it
      // from a page where the app isn't running, or the app's save-on-unload would write the
      // previous game straight back.
      await page.goto("/api/health");
      await page.evaluate(() => localStorage.clear());
      await page.goto("/");

      const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio }));
      await testInfo.attach("viewport", { body: JSON.stringify({ profile, viewport, appUrl }, null, 2), contentType: "application/json" });
      expect(viewport.width, "the CSS viewport should match the profile").toBeGreaterThanOrEqual(profile.width * 0.9);
      expect(viewport.width).toBeLessThanOrEqual(profile.width * 1.1);

      await onboard(page, "Ana", "enter");
      expect(await fitsViewportWidth(page), "world screen fits the screen width").toBe(true);

      // Phones get a bottom sheet over the map; tablets keep the side panel.
      const panel = await page.locator(".side-panel").boundingBox();
      expect(panel).not.toBeNull();
      if (profile.name === "phone") expect(panel!.width).toBeGreaterThanOrEqual(viewport.width * 0.95);
      else expect(panel!.width).toBeLessThan(viewport.width * 0.7);

      await travelToNairobi(page);
      await page.getByTestId("meet-npc-1").tap();
      await expect(page.getByRole("meter", { name: /Rapport/ })).toBeVisible();
      expect(await bottomOf(page, "send-btn"), "the send button is reachable without scrolling").toBeLessThanOrEqual(viewport.height + 1);

      await say(page, "Habari! What are you working on today?", "tap");
      await say(page, "You people must all be poor here", "tap");
      await expect(page.locator(".msg--player").last().locator(".move--watch")).toContainText("assumption");
      await page.getByTestId("coach-btn").tap();
      await expect(page.locator(".coach__hint")).toBeVisible();
      await say(page, "That sounds hard. How are you holding up?", "tap");
      await say(page, "Thank you for sharing. Take care, goodbye!", "tap");
      await expect(page.getByText("You said goodbye.")).toBeVisible();
      expect(await fitsViewportWidth(page), "encounter fits the screen width").toBe(true);

      await page.getByTestId("rate-4").tap();
      await page.getByTestId("get-feedback").tap();
      await expect(page.getByTestId("debrief")).toBeVisible();
      await expect(page.getByTestId("debrief").locator(".evidence--watch")).toContainText("You people must all be poor here");
      expect(await fitsViewportWidth(page), "debrief fits the screen width").toBe(true);

      await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /^Journal/ }).tap();
      await expect(page.locator(".insight-card").first()).toBeVisible();

      expect(pageErrors, "no uncaught errors in the page").toEqual([]);
    } finally {
      await context.close();
    }
  });
}

const phone = PROFILES.find((p) => p.name === "phone")!;

/** A fresh game in Chromium on the phone, as in the journey above. */
async function freshPhoneGame(extraArgs: string[] = []) {
  await setDisplay(device, phone);
  const context = await launchBrowser(device, appUrlForDevice(E2E_PORT), extraArgs);
  const page = context.pages()[0] ?? (await context.newPage());
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/api/health");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/");
  return { context, page, pageErrors };
}

test("mediation on a real Android phone: two locals at odds, to an agreement", async () => {
  const { context, page, pageErrors } = await freshPhoneGame();
  try {
    await onboard(page, "Ana", "enter");
    await travelToNairobi(page);
    await page.getByTestId("start-mediation").tap();
    const mediation = page.getByTestId("mediation");
    await expect(mediation.getByRole("meter", { name: /Tension/ })).toBeVisible();
    await expect(mediation.locator(".party")).toHaveCount(2);
    expect(await fitsViewportWidth(page), "the mediation fits the screen width").toBe(true);
    const viewport = await page.evaluate(() => window.innerHeight);
    const send = await page.getByTestId("send-btn").boundingBox();
    expect(send && send.y + send.height, "Send is reachable without scrolling").toBeLessThanOrEqual(viewport + 1);

    const settled = page.getByText(/agreed:/);
    for (const line of [
      "I can hear you're both frustrated. What matters most to each of you here?",
      "So it sounds like you both want this street to work. That makes sense — it's hard when it feels unfair.",
      "Thank you both for explaining. What if you could both keep what matters most to you?",
      "How about you share it and take turns, so it works for both of you?",
    ]) {
      if (await settled.isVisible()) break;
      await say(page, line, "tap");
    }
    await expect(settled).toBeVisible();
    await page.getByTestId("rate-4").tap();
    await page.getByTestId("get-feedback").tap();
    await expect(page.getByTestId("debrief")).toBeVisible();
    expect(await fitsViewportWidth(page), "the mediation debrief fits the screen width").toBe(true);
    expect(pageErrors, "no uncaught errors in the page").toEqual([]);
  } finally {
    await context.close();
  }
});

test("voice on a real Android phone: practise the greeting, speak to a local", async () => {
  const { context, page, pageErrors } = await freshPhoneGame(await allowFakeMicrophone(device));
  try {
    await onboard(page, "Ana", "enter");
    const nav = page.getByRole("navigation", { name: "Main" });
    await nav.getByRole("button", { name: /Settings/ }).tap();
    await page.getByTestId("voice-input-toggle").tap();
    await expect(page.getByTestId("voice-input-toggle")).toBeChecked();
    await nav.getByRole("button", { name: /World/ }).tap();
    await travelToNairobi(page);

    const practise = page.getByTestId("pronounce-btn").first();
    await practise.tap();
    await page.waitForTimeout(1_500);
    await practise.tap();
    await expect(page.getByTestId("pronounce-result").first()).toContainText("/100");

    await page.getByTestId("meet-npc-1").tap();
    await expect(page.getByRole("meter", { name: /Rapport/ })).toBeVisible();
    await page.getByTestId("mic-btn").tap();
    await page.waitForTimeout(1_500);
    await page.getByTestId("mic-btn").tap();
    await expect(page.getByRole("textbox", { name: /Your message/ })).toHaveValue(FAKE_HEARD);
    await expect(page.getByTestId("heard")).toBeVisible();
    await page.getByTestId("send-btn").tap();
    await expect(page.locator(".msg--player").last().locator(".delivery")).toBeVisible();
    await expect(page.locator(".msg.is-streaming")).toHaveCount(0);
    expect(await fitsViewportWidth(page), "voice mode fits the screen width").toBe(true);
    expect(pageErrors, "no uncaught errors in the page").toEqual([]);
  } finally {
    await context.close();
  }
});
