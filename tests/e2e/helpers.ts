// Player actions shared by the desktop and Android journeys.
import { expect, type Page } from "@playwright/test";

/**
 * How a text entry is submitted. On a real phone the on-screen keyboard can cover or shift
 * buttons, so mobile journeys submit with Enter, as people do with the keyboard's send key.
 */
export type Submit = "click" | "enter";

export async function onboard(page: Page, name = "Sam", submit: Submit = "click") {
  await page.goto("/");
  await page.getByRole("button", { name: "Begin your journey" }).click();
  const nameField = page.getByLabel("Your name");
  await nameField.fill(name);
  if (submit === "enter") await nameField.press("Enter");
  else await page.getByRole("button", { name: "Next" }).click();
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

export async function say(page: Page, text: string, submit: Submit = "click") {
  const message = page.getByRole("textbox", { name: /Your message/ });
  await message.fill(text);
  if (submit === "enter") await message.press("Enter");
  else await page.getByTestId("send-btn").click();
  await expect(page.locator(".msg--player").last()).toContainText(text);
  await expect(page.locator(".msg.is-streaming")).toHaveCount(0);
}

/** True when nothing on the page is wider than the viewport. */
export function fitsViewportWidth(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}
