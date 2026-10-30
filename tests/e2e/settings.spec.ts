// The server's settings page: unlock it with the settings key, change settings, and see them
// apply without a restart, in this browser at once and in others on their next look.
import { expect, test } from "@playwright/test";
import { onboard } from "./helpers.ts";
import { startOwnServer } from "./ownServer.ts";

const PORT = 8794;
let stop: (() => void) | undefined;

test.use({ baseURL: `http://127.0.0.1:${PORT}` });
test.beforeAll(async () => {
  stop = await startOwnServer(PORT);
});
test.afterAll(() => stop?.());

test("change the server's settings in the browser: they apply without a restart", async ({ page, browser }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await onboard(page, "Ada");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("button", { name: /Class/ })).toBeVisible();
  await nav.getByRole("button", { name: /Settings/ }).click();
  await page.getByTestId("open-server-settings").click();

  // The key guards it.
  await page.getByTestId("settings-key").fill("a guess");
  await page.getByTestId("unlock-settings").click();
  await expect(page.getByRole("alert")).toContainText("That isn't the settings key.");
  await page.getByTestId("settings-key").fill("e2e-settings-key");
  await page.getByTestId("unlock-settings").click();
  const status = page.getByTestId("server-status");
  await expect(status).toContainText("Demo AI");
  await expect(page.getByTestId("source-ADMIN_KEY")).toContainText("From ADMIN_KEY");

  // A bad value is caught before saving.
  await page.getByTestId("setting-AI_BASE_URL").fill("not a web address");
  await expect(page.getByText("That isn't a web address.")).toBeVisible();
  await expect(page.getByTestId("save-settings")).toBeDisabled();
  await page.getByTestId("setting-AI_BASE_URL").fill("");
  await expect(page.getByText("Everything is saved.")).toBeVisible();

  // Classes off, an access code on: one save, no restart.
  await page.getByTestId("setting-CLASSROOM").uncheck();
  await page.getByTestId("setting-ACCESS_CODE").fill("maple");
  await expect(page.getByText("2 unsaved changes")).toBeVisible();
  await page.getByTestId("save-settings").click();
  await expect(page.getByText("Applied without a restart")).toBeVisible();
  await expect(status).toContainText(/Classroom\s*Off/);
  await expect(page.getByTestId("source-ACCESS_CODE")).toContainText("Set here");
  // This browser took the new configuration at once: no Class tab any more.
  await expect(nav.getByRole("button", { name: /Class/ })).toHaveCount(0);

  // Another player now needs the code.
  const other = await browser.newContext({ baseURL: `http://127.0.0.1:${PORT}` });
  const visitor = await other.newPage();
  await visitor.goto("/");
  await expect(visitor.getByRole("heading", { name: "Enter the access code" })).toBeVisible();
  await other.close();

  // A secret is write-only: the page gets its last characters, never the value.
  await page.getByTestId("setting-MM_GATEWAY_API_KEY").fill("gw-secret-0123456789abcd");
  await page.getByTestId("setting-MM_GATEWAY_URL").fill("http://127.0.0.1:9/");
  await page.getByTestId("save-settings").click();
  await expect(page.getByTestId("setting-MM_GATEWAY_API_KEY")).toHaveAttribute("placeholder", /abcd/);
  const view = await page.request.get("/api/admin/settings", { headers: { "x-admin-key": "e2e-settings-key" } });
  expect(await view.text()).not.toContain("gw-secret-0123456789abcd");
  await expect(status).toContainText(/Postcards\s*On/);

  // Back to how it was: reset each one.
  for (const key of ["CLASSROOM", "ACCESS_CODE", "MM_GATEWAY_API_KEY", "MM_GATEWAY_URL"]) await page.getByTestId(`reset-${key}`).click();
  await page.getByTestId("save-settings").click();
  await expect(status).toContainText(/Classroom\s*On/);
  await expect(status).toContainText(/Access code\s*none/);
  await expect(nav.getByRole("button", { name: /Class/ })).toBeVisible();

  // Locking forgets the key.
  await page.getByTestId("lock-settings").click();
  await expect(page.getByTestId("settings-key")).toBeVisible();
  expect(errors).toEqual([]);
});

test("the settings page opens straight from /#settings, before anyone plays", async ({ page }) => {
  await page.goto("/#settings");
  await expect(page.getByRole("heading", { name: "Server settings" })).toBeVisible();
  await expect(page.getByTestId("settings-key")).toBeVisible();
  await page.getByRole("button", { name: /Back/ }).click();
  await expect(page.getByRole("button", { name: "Begin your journey" })).toBeVisible();
});
