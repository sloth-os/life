import { defineConfig, devices } from "@playwright/test";

const port = 8790;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  // In CI the HTML report is uploaded as an artifact when a run fails.
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }], ["list"]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run build && node tests/e2e/server.ts",
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // The Android device reaches the server from Docker, so the mobile run sets E2E_HOST=0.0.0.0.
    // A stand-in voice model lets voice mode run without a real one (tests/e2e/fakeVoice.ts).
    env: { E2E_PORT: String(port), E2E_HOST: process.env.E2E_HOST ?? "127.0.0.1", E2E_FAKE_VOICE: "1" },
  },
  projects: [
    {
      name: "desktop",
      testIgnore: /android\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 860 },
        // Chromium's fake microphone (a tone) for voice mode; the stand-in model hears it as a line.
        permissions: ["microphone"],
        launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
      },
    },
    // Chromium on a real Android device (redroid); see tests/e2e/android-device.ts.
    { name: "mobile", testMatch: /android\.spec\.ts/, timeout: 300_000 },
  ],
});
