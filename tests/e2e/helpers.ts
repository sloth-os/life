// Player actions shared by the desktop and Android journeys.
import { expect, type Page } from "@playwright/test";

export async function onboard(page: Page, name = "Sam") {
  await page.goto("/");
  await page.getByRole("button", { name: "Begin your journey" }).click();
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("radio", { name: /Listening/ }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Open the map" }).click();
  await expect(page.getByRole("heading", { name: `Where to next, ${name}?` })).toBeVisible();
}

export async function travelToNairobi(page: Page) {
  await page.locator(".postcard-row", { hasText: "Nairobi" }).click();
  await expect(page.getByTestId("travel-card")).toContainText("Nairobi");
  await page.getByRole("button", { name: "Travel here" }).click();
  await expect(page.getByRole("heading", { name: /Nairobi/ }).first()).toBeVisible();
  await expect(page.getByText("Say hello in Swahili")).toBeVisible();
}

export async function say(page: Page, text: string) {
  await page.getByRole("textbox", { name: /Your message/ }).fill(text);
  await page.getByTestId("send-btn").click();
  await expect(page.locator(".msg.is-streaming")).toHaveCount(0);
}

/** True when nothing on the page is wider than the viewport. */
export function fitsViewportWidth(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}
