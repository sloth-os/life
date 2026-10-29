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
  await say(page, "So you've been here for years — what has changed the most?", "enter");
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

  // Explain the debrief: a follow-up question, answered from this conversation.
  await debrief.getByRole("button", { name: "How could I have said that differently?" }).click();
  await expect(debrief.getByTestId("qa-answer")).toContainText("You could try");
  await debrief.getByTestId("ask-input").fill("What did I do well?");
  await debrief.getByTestId("ask-btn").click();
  await expect(debrief.getByTestId("qa-answer")).toHaveCount(2);
  await expect(debrief.getByText("3 questions left.")).toBeVisible();

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

test("mediate between two locals at odds, then get mentored", async ({ page }) => {
  await onboard(page);
  await travelToNairobi(page);
  await page.getByTestId("start-mediation").click();
  const mediation = page.getByTestId("mediation");
  await expect(mediation.getByRole("meter", { name: /Tension/ })).toBeVisible();
  await expect(mediation.locator(".party")).toHaveCount(2);
  const before = Number(await mediation.getByTestId("tension").getAttribute("aria-valuenow"));

  // Listening to each side and asking what matters cools things down…
  await say(page, "I can hear you're both frustrated. What matters most to each of you here?");
  await expect(page.locator(".msg--player").last().locator(".move--good").first()).toBeVisible();
  const after = Number(await mediation.getByTestId("tension").getAttribute("aria-valuenow"));
  expect(after).toBeLessThan(before);
  // …and a fair proposal, once both feel heard, settles it.
  const settled = page.getByText(/agreed:/);
  for (const line of [
    "So it sounds like you both want this street to work. That makes sense — it's hard when it feels unfair.",
    "Thank you both for explaining. What if you could both keep what matters most to you?",
    "How about you share it and take turns, so it works for both of you?",
  ]) {
    if (await settled.isVisible()) break;
    await say(page, line);
  }
  await expect(settled).toBeVisible();
  await page.getByTestId("rate-4").click();
  await page.getByTestId("get-feedback").click();
  const debrief = page.getByTestId("debrief");
  await expect(debrief).toBeVisible();
  await expect(debrief.getByRole("heading", { level: 1 })).not.toBeEmpty();
  await expect(debrief.getByText(/&/).first()).toBeVisible();
});
