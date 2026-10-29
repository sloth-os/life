// Mobile end-to-end: the full journey in Chromium on a real Android device (redroid), at phone
// and tablet sizes. Touch is real touch; layout is the browser's own, not desktop emulation.
import { expect, test, type AndroidDevice, type Page } from "@playwright/test";
import { PROFILES, appUrlForDevice, connectDevice, deviceDiagnostics, launchBrowser, resetDisplay, setDisplay } from "./android-device.ts";
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

      // A fresh game for each profile: the browser profile persists between launches.
      await page.goto("/");
      await page.evaluate(() => localStorage.clear());

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

      await say(page, "Habari! What are you working on today?", "enter");
      await say(page, "You people must all be poor here", "enter");
      await expect(page.locator(".msg--player").last().locator(".move--watch")).toContainText("assumption");
      await page.getByTestId("coach-btn").tap();
      await expect(page.locator(".coach__hint")).toBeVisible();
      await say(page, "That sounds hard. How are you holding up?", "enter");
      await say(page, "Thank you for sharing. Take care, goodbye!", "enter");
      await expect(page.getByText("You said goodbye.")).toBeVisible();
      expect(await fitsViewportWidth(page), "encounter fits the screen width").toBe(true);

      await page.getByTestId("rate-4").tap();
      await page.getByTestId("get-feedback").tap();
      await expect(page.getByTestId("debrief")).toBeVisible();
      await expect(page.getByTestId("debrief").locator(".evidence--watch")).toContainText("You people must all be poor here");
      expect(await fitsViewportWidth(page), "debrief fits the screen width").toBe(true);

      await page.getByRole("button", { name: "Journal" }).tap();
      await expect(page.locator(".insight-card").first()).toBeVisible();

      expect(pageErrors, "no uncaught errors in the page").toEqual([]);
    } finally {
      await context.close();
    }
  });
}
