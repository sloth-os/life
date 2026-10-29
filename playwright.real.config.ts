import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const port = 8791;
/**
 * Speech CI synthesizes with espeak-ng; Chromium plays it as the microphone (a beep if it's
 * missing), on a loop: without one, only the first recording in the browser hears it.
 */
// Outside outputDir, which Playwright empties when a run starts.
const microphone = resolve("test-results/speech/voice-input.wav");

/**
 * The real-services suite: Google Maps in the browser, live grounding and a real model, with
 * real costs. The server is the production build, configured entirely by the environment
 * (AI_PROVIDER, AI_MODEL, AI_BASE_URL, AI_API_KEY, GOOGLE_MAPS_API_KEY, GOOGLE_MAPS_MAP_ID).
 */
export default defineConfig({
  testDir: "tests/e2e-real",
  outputDir: "test-results/real",
  // Thinking models can take minutes per step (tests/e2e-real/real.spec.ts).
  timeout: 30 * 60_000,
  expect: { timeout: 3 * 60_000 },
  fullyParallel: false,
  workers: 1,
  // A failure is reported, not paid for twice.
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["html", { open: "never", outputFolder: "playwright-report-real" }], ["list"]] : "list",
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1366, height: 860 },
    // localhost rather than 127.0.0.1: browser Maps keys are usually referrer-restricted, and
    // localhost is what such allow-lists tend to include.
    baseURL: `http://localhost:${port}`,
    // No traces: they record network traffic, which includes the browser Maps key.
    trace: "off",
    // A click that can never happen (a hidden element) fails in a minute, not at the test timeout.
    actionTimeout: 60_000,
    screenshot: "only-on-failure",
    video: "off",
    permissions: ["microphone"],
    launchOptions: {
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${microphone}`, "--autoplay-policy=no-user-gesture-required"],
    },
  },
  webServer: {
    command: "npm run build && node server/index.ts",
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // The server's [openai]/[claude] lines (timings, fallbacks, errors) belong in the CI log.
    stdout: "pipe",
    env: { PORT: String(port) },
  },
});
