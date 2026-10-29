import { expect, test } from "@playwright/test";
import { onboard, say, travelToNairobi } from "./helpers.ts";

test("a full expedition: meet a local, talk, reflect, get mentored, review", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await onboard(page);
  await travelToNairobi(page);

  const meet = page.getByTestId("meet-npc-1");
  await expect(meet).toBeEnabled();
  await meet.click();
  await expect(page.getByRole("meter", { name: /Rapport/ })).toBeVisible();

  await say(page, "Habari! What are you working on today?");
  await expect(page.locator(".msg--player .move--good").first()).toBeVisible();
  await say(page, "So you've been here for years — what has changed the most?");
  await say(page, "You people must all be poor here");
  await expect(page.locator(".msg--player").last().locator(".move--watch")).toContainText("assumption");

  await page.getByTestId("coach-btn").click();
  await expect(page.locator(".coach__hint")).toBeVisible();

  await say(page, "That sounds hard. How are you holding up?");
  await say(page, "Thank you for sharing. Take care, goodbye!");
  await expect(page.getByText("You said goodbye.")).toBeVisible();

  await page.getByTestId("rate-3").click();
  await page.getByTestId("get-feedback").click();
  const debrief = page.getByTestId("debrief");
  await expect(debrief).toBeVisible();
  await expect(debrief.getByRole("heading", { name: "How your words landed" })).toBeVisible();
  await expect(debrief.locator(".evidence--watch")).toContainText("You people must all be poor here");
  await expect(debrief.getByText(/Field mission/i)).toBeVisible();

  await page.getByTestId("debrief-done").click();
  await expect(page.getByRole("button", { name: /Visit .* again/ }).first()).toBeVisible();

  await page.getByRole("button", { name: /Journal/ }).click();
  await expect(page.locator(".insight-card").first()).toBeVisible();
  await page.getByRole("tab", { name: /Review/ }).click();
  const recall = page.getByTestId("recall");
  await recall.locator(".recall__option").first().click();
  await expect(recall.locator(".recall__feedback")).toBeVisible();

  await page.getByRole("button", { name: /Compass/ }).click();
  await expect(page.getByRole("img", { name: /Skill Compass/ })).toBeVisible();

  expect(errors).toEqual([]);
});

test("progress survives a reload", async ({ page }) => {
  await onboard(page, "Ana");
  await travelToNairobi(page);
  await page.reload();
  await page.getByRole("button", { name: "Continue as Ana" }).click();
  await page.getByRole("button", { name: /Journal/ }).click();
  await page.getByRole("tab", { name: /Places/ }).click();
  await expect(page.locator(".place-card")).toContainText("Nairobi");
});

test("each local starts a fresh conversation", async ({ page }) => {
  await onboard(page, "Kai");
  await travelToNairobi(page);
  await page.getByTestId("meet-npc-2").click();
  await say(page, "Hi! How is your day going so far?");
  await expect(page.locator(".msg--npc")).toHaveCount(2);
  const box = await page.getByTestId("send-btn").boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
});
