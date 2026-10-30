// A real Android device for the mobile journey: redroid (Android in Docker) driven over ADB
// through Playwright's Android support, as in the speak project. Start one with
// scripts/start-redroid.sh.
import { execFileSync } from "node:child_process";
import { _android, expect, type AndroidDevice, type BrowserContext } from "@playwright/test";

export const BROWSER_PACKAGE = process.env.ANDROID_BROWSER_PACKAGE?.trim() || "org.chromium.chrome";

export interface DisplayProfile {
  name: "phone" | "tablet";
  /** Target CSS viewport, in density-independent pixels. */
  width: number;
  height: number;
  density: number;
}

export const PROFILES: DisplayProfile[] = [
  { name: "phone", width: 390, height: 844, density: 420 },
  { name: "tablet", width: 768, height: 1024, density: 240 },
];

/**
 * redroid runs in Docker, so the device reaches the host's test server through the bridge
 * network's gateway (the server must listen beyond loopback: E2E_HOST=0.0.0.0).
 */
export function appUrlForDevice(port: number): string {
  const override = process.env.ANDROID_APP_URL?.trim();
  if (override) return override;
  let gateway = "";
  try {
    gateway = execFileSync("docker", ["network", "inspect", "bridge", "--format", "{{(index .IPAM.Config 0).Gateway}}"], { encoding: "utf8" }).trim();
  } catch {
    // fall through to Docker's default bridge gateway
  }
  return `http://${gateway || "172.17.0.1"}:${port}`;
}

export async function connectDevice(): Promise<AndroidDevice> {
  const devices = await _android.devices();
  expect(devices.length, "an Android device must be connected over ADB — run scripts/start-redroid.sh").toBeGreaterThan(0);
  return devices[0]!;
}

/** Resize the display so the browser's CSS viewport matches the profile. */
export async function setDisplay(device: AndroidDevice, profile: DisplayProfile): Promise<void> {
  const scale = profile.density / 160;
  await device.shell(`wm density ${profile.density}`);
  await device.shell(`wm size ${Math.round(profile.width * scale)}x${Math.round(profile.height * scale)}`);
}

export async function resetDisplay(device: AndroidDevice): Promise<void> {
  await device.shell("wm size reset");
  await device.shell("wm density reset");
}

export function launchBrowser(device: AndroidDevice, appUrl: string, extraArgs: string[] = []): Promise<BrowserContext> {
  return device.launchBrowser({
    pkg: BROWSER_PACKAGE,
    baseURL: appUrl,
    hasTouch: true,
    args: [
      // The test server is plain HTTP on a private address; treat it like a deployed HTTPS site.
      `--unsafely-treat-insecure-origin-as-secure=${new URL(appUrl).origin}`,
      "--disable-features=HttpsUpgrades,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults",
      ...extraArgs,
    ],
  });
}

/**
 * Chromium's fake microphone (a tone), for voice mode: the browser asks no questions and the
 * stand-in voice model hears it as a line. Android also wants the app allowed to record.
 */
export async function allowFakeMicrophone(device: AndroidDevice): Promise<string[]> {
  await device.shell(`pm grant ${BROWSER_PACKAGE} android.permission.RECORD_AUDIO`).catch(() => undefined);
  return ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"];
}

/** Android logs for a failed run, attached to the report. */
export async function deviceDiagnostics(device: AndroidDevice): Promise<string> {
  const read = async (command: string) => (await device.shell(command)).toString().trim();
  const [size, density, chromium] = await Promise.all([read("wm size"), read("wm density"), read("logcat -d -t 200 2>/dev/null | grep -iE 'chromium|cr_' | tail -n 80")]);
  return `${size}\n${density}\n--- logcat (chromium) ---\n${chromium}`;
}
