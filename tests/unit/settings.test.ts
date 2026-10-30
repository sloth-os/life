// The settings page's server side: where values come from, saving and applying them without a
// restart (only the services a change touches are rebuilt), edits to settings.json applying the
// same way, the settings key, and the admin API's guard rails. Secrets never come back.
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoGameAI } from "../../server/ai/demo.ts";
import { createApp } from "../../server/app.ts";
import { loadConfig } from "../../server/config.ts";
import { Runtime } from "../../server/runtime.ts";
import { describeSettings, layerEnv } from "../../server/settings/env.ts";
import { SettingsService, warningsFor } from "../../server/settings/service.ts";
import { FileSettingsStore } from "../../server/settings/store.ts";
import { HttpError } from "../../server/util/errors.ts";
import type { AppConfig } from "../../shared/schemas.ts";
import { SETTINGS, type SettingsView } from "../../shared/settings.ts";
import { fakeOpenDataFetch } from "./openDataFetch.ts";

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function setup(processEnv: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "life-settings-"));
  const env = { DATA_DIR: dir, ...processEnv };
  const store = await FileSettingsStore.open(dir);
  const runtime = await Runtime.start(loadConfig(env, []), { log: () => {}, createAI: () => new DemoGameAI({ typingDelayMs: 0 }), fetchImpl: fakeOpenDataFetch() });
  const probe = vi.fn(async (_target: string, _config: unknown) => ({ ok: true, ms: 1, message: "reached" }));
  const settings = new SettingsService({ store, runtime, processEnv: env, log: () => {}, probe });
  cleanups.push(() => settings.close(), () => runtime.close(), () => store.close());
  return { dir, store, runtime, settings, probe };
}

describe("where settings come from", () => {
  it("layers the page over the process over .env", () => {
    const env = layerEnv({ AI_MODEL: "from-process", PORT: "1" }, { AI_MODEL: "from-dotenv", VOICE_MODEL: "dotenv-voice" }, { AI_MODEL: "from-page" });
    expect(env).toMatchObject({ AI_MODEL: "from-page", VOICE_MODEL: "dotenv-voice", PORT: "1" });
    expect(layerEnv({ AI_MODEL: "from-process" }, { AI_MODEL: "from-dotenv" }, {}).AI_MODEL).toBe("from-process");
  });

  it("empties stand-in variables when the page empties a setting, and ignores start-up settings", () => {
    const env = layerEnv({ ANTHROPIC_API_KEY: "sk-ant-from-env", PORT: "8787" }, {}, { AI_API_KEY: "", PORT: "9999", ADMIN_KEY: "page-key" });
    expect(env.ANTHROPIC_API_KEY).toBe("");
    expect(loadConfig(env, []).aiProvider).toBe("demo");
    expect(env.PORT).toBe("8787");
    expect(env.ADMIN_KEY).toBeUndefined();
  });

  it("describes each setting's source without giving secrets away", () => {
    const states = describeSettings({ ANTHROPIC_API_KEY: "sk-ant-api03-abcdefgh1234", AI_MODEL: "claude-env" }, { AI_MODEL: "claude-page", ACCESS_CODE: "maple" });
    expect(states.AI_API_KEY).toEqual({ source: "env", envKey: "ANTHROPIC_API_KEY", hint: "…1234", envHint: "…1234" });
    expect(JSON.stringify(states)).not.toContain("abcdefgh");
    expect(states.AI_MODEL).toMatchObject({ source: "page", value: "claude-page", envValue: "claude-env" });
    expect(states.RATE_LIMIT_PER_10MIN).toMatchObject({ source: "default", value: "120" });
    expect(states.ACCESS_CODE).toMatchObject({ source: "page", value: "maple" });
  });

  it("puts every variable the server reads on the settings page", async () => {
    const source = await readFile("server/config.ts", "utf8");
    const read = new Set<string>();
    for (const call of source.matchAll(/value\(([^)]*)\)/g)) for (const name of call[1]!.matchAll(/"([A-Z][A-Z0-9_]+)"/g)) read.add(name[1]!);
    for (const name of source.matchAll(/env\.([A-Z][A-Z0-9_]+)/g)) read.add(name[1]!);
    const onPage = new Set(SETTINGS.flatMap((s) => [s.key, ...(s.aliases ?? [])]));
    expect(read.size).toBeGreaterThan(25);
    // NODE_ENV is how Node is run, not a setting of the game's.
    expect([...read].filter((name) => !onPage.has(name) && name !== "NODE_ENV")).toEqual([]);
  });

  it("warns about settings that leave something off", () => {
    const env = { AI_API_KEY: "k", MM_GATEWAY_URL: "http://gw", MAPS_WALKING_ROUTES: "true" };
    const warnings = warningsFor(loadConfig(env, []), env).join("\n");
    expect(warnings).toContain("AI_PROVIDER is auto");
    expect(warnings).toContain("MM_GATEWAY_API_KEY");
    expect(warnings).toContain("Walking routes need GOOGLE_MAPS_SERVER_KEY");
  });
});

describe("SettingsService", () => {
  it("saves, then rebuilds only what the change touches, without a restart", async () => {
    const { settings, runtime, dir } = await setup();
    const before = runtime.current;
    const saved = await settings.update({ values: { CLASSROOM: "off", RATE_LIMIT_PER_10MIN: "40" }, revision: 0 });
    expect(saved.applied.sort()).toEqual(["access", "classroom"]);
    const after = runtime.current;
    expect(after.revision).toBe(before.revision + 1);
    expect(after.classroom).toBeUndefined();
    expect(after.config.rateLimitPer10Min).toBe(40);
    // The AI and grounding weren't touched: same engine, same caches.
    expect(after.engine).toBe(before.engine);
    expect(after.grounding).toBe(before.grounding);
    expect(JSON.parse(await readFile(join(dir, "settings.json"), "utf8"))).toMatchObject({ revision: 1, values: { CLASSROOM: "off", RATE_LIMIT_PER_10MIN: "40" } });

    // A request already running keeps what it started with.
    const switched = await settings.update({ values: { AI_PROVIDER: "openai", AI_MODEL: "qwen-test", AI_BASE_URL: "http://127.0.0.1:9/v1" } });
    expect(switched.applied).toEqual(["ai"]);
    expect(runtime.current.engine).not.toBe(after.engine);
    expect(after.engine.aiMode).toBe("demo");
    expect(runtime.current.config).toMatchObject({ aiProvider: "openai", model: "qwen-test" });

    // Nothing changed, nothing rebuilt, same revision.
    const revision = runtime.current.revision;
    const again = await settings.update({ values: { AI_MODEL: "qwen-test" } });
    expect(again.applied).toEqual([]);
    expect(runtime.current.revision).toBe(revision);
  });

  it("refuses what it can't use, and doesn't save it", async () => {
    const { settings, store } = await setup();
    const status = async (work: () => Promise<unknown>) => {
      try {
        await work();
        return null;
      } catch (error) {
        return [(error as HttpError).status, (error as HttpError).code];
      }
    };
    expect(await status(() => settings.update({ values: { RATE_LIMIT_PER_10MIN: "lots" } }))).toEqual([400, "invalid_setting"]);
    expect(await status(() => settings.update({ values: { AI_BASE_URL: "ftp://x" } }))).toEqual([400, "invalid_setting"]);
    expect(await status(() => settings.update({ values: { PORT: "9" } }))).toEqual([400, "bootstrap_setting"]);
    expect(await status(() => settings.update({ values: { NOT_A_SETTING: "x" } }))).toEqual([400, "unknown_setting"]);
    expect(await status(() => settings.update({ values: { AI_PROVIDER: "openai" } }))).toEqual([400, "invalid_settings"]);
    expect(store.current().revision).toBe(0);
    await settings.update({ values: { ACCESS_CODE: "maple" } });
    expect(await status(() => settings.update({ values: { ACCESS_CODE: "oak" }, revision: 0 }))).toEqual([409, "settings_conflict"]);
  });

  it("applies an edit to settings.json without a restart", async () => {
    const { settings, runtime, dir } = await setup();
    settings.watch();
    await settings.update({ values: { ACCESS_CODE: "maple" } });
    const file = join(dir, "settings.json");
    const data = JSON.parse(await readFile(file, "utf8")) as { values: Record<string, string> };
    data.values.ACCESS_CODE = "birch";
    data.values.CLASSROOM = "off";
    await writeFile(file, JSON.stringify(data));
    await vi.waitFor(() => expect(runtime.current.config.accessCode).toBe("birch"), { timeout: 3_000 });
    expect(runtime.current.classroom).toBeUndefined();
    // A broken edit is ignored: the running settings stay.
    await writeFile(file, "{ not json");
    await new Promise((r) => setTimeout(r, 400));
    expect(runtime.current.config.accessCode).toBe("birch");
  });

  it("makes a key once, checks it, and replaces it on request", async () => {
    const { settings, store } = await setup();
    const key = await settings.ensureKey();
    expect(key).toMatch(/^[\w-]{24}$/);
    expect(await settings.ensureKey()).toBeNull();
    expect(settings.verify(key!)).toBe(true);
    expect(settings.verify("guess")).toBe(false);
    expect(settings.verify(undefined)).toBe(false);
    expect(JSON.stringify(store.current())).not.toContain(key!);
    const fresh = await settings.rotateKey();
    expect(settings.verify(fresh)).toBe(true);
    expect(settings.verify(key!)).toBe(false);

    const fromEnv = await setup({ ADMIN_KEY: "chosen-key" });
    expect(fromEnv.settings.keySource).toBe("env");
    expect(await fromEnv.settings.ensureKey()).toBeNull();
    expect(fromEnv.settings.verify("chosen-key")).toBe(true);
    await expect(fromEnv.settings.rotateKey()).rejects.toMatchObject({ code: "key_from_env" });
  });

  it("tests a service with the form's values, saved or not", async () => {
    const { settings, probe } = await setup();
    expect(await settings.probe("ai", { AI_PROVIDER: "openai", AI_MODEL: "draft-model" })).toMatchObject({ ok: true });
    expect(probe.mock.calls[0]![1]).toMatchObject({ aiProvider: "openai", model: "draft-model" });
  });
});

describe("the admin API", () => {
  async function serve(processEnv: Record<string, string> = { ADMIN_KEY: "the-key" }) {
    const parts = await setup(processEnv);
    const app = createApp({ services: () => parts.runtime.current, settings: parts.settings, log: () => {} });
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    cleanups.push(() => server.close());
    return { ...parts, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api` };
  }
  const send = (url: string, method: string, key?: string, body?: unknown) =>
    fetch(url, { method, headers: { "content-type": "application/json", ...(key ? { "x-admin-key": key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });

  it("needs the key, applies a save at once, and never returns a secret", async () => {
    const { url } = await serve();
    expect(await (await fetch(`${url}/admin/status`)).json()).toEqual({ enabled: true, keySource: "env" });
    expect((await send(`${url}/admin/settings`, "GET")).status).toBe(401);
    expect((await send(`${url}/admin/settings`, "GET", "wrong")).status).toBe(401);

    const before = (await (await fetch(`${url}/config`)).json()) as AppConfig;
    const response = await send(`${url}/admin/settings`, "PUT", "the-key", { values: { CLASSROOM: "off", AI_API_KEY: "sk-very-secret-value-9876" }, revision: 0 });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    expect(text).not.toContain("sk-very-secret-value-9876");
    expect((JSON.parse(text) as SettingsView).settings.AI_API_KEY).toMatchObject({ source: "page", hint: "…9876" });

    const after = (await (await fetch(`${url}/config`)).json()) as AppConfig;
    expect(after.revision).toBeGreaterThan(before.revision);
    expect(before.features.classroom).toBe(true);
    expect(after.features.classroom).toBe(false);
    expect(JSON.stringify(after)).not.toContain("sk-very-secret");
  });

  it("works without the players' access code, and makes everyone else use it at once", async () => {
    const { url } = await serve();
    await send(`${url}/admin/settings`, "PUT", "the-key", { values: { ACCESS_CODE: "maple" } });
    expect((await fetch(`${url}/geo/search?q=Kyoto`)).status).toBe(401);
    expect((await fetch(`${url}/geo/search?q=Kyoto`, { headers: { "x-access-code": "maple" } })).status).toBe(200);
    expect((await send(`${url}/admin/settings`, "GET", "the-key")).status).toBe(200);
  });

  it("locks an address out after too many wrong keys, right key or not", async () => {
    const { url } = await serve();
    for (let i = 0; i < 20; i++) expect((await send(`${url}/admin/session`, "POST", `guess-${i}`, {})).status).toBe(401);
    expect((await send(`${url}/admin/session`, "POST", "the-key", {})).status).toBe(429);
  });

  it("says when the page is off", async () => {
    const parts = await setup();
    const app = createApp({ services: () => parts.runtime.current, log: () => {} });
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    cleanups.push(() => server.close());
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    expect(await (await fetch(`${url}/admin/status`)).json()).toEqual({ enabled: false, keySource: null });
    expect((await send(`${url}/admin/settings`, "GET", "anything")).status).toBe(404);
  });
});
