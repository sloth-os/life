// The SQLite store (DATABASE_URL=sqlite:…), which needs nothing but Node: what the URL names, a
// file only the server's user can read, classes shared by two processes without losing anyone's
// changes, and settings saved by one process applying in another without a restart.
import { spawn } from "node:child_process";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoGameAI } from "../../server/ai/demo.ts";
import { ClassroomStore } from "../../server/classroom/store.ts";
import { loadConfig } from "../../server/config.ts";
import { openDatabase, parseDatabaseUrl, type Database } from "../../server/db.ts";
import { Runtime } from "../../server/runtime.ts";
import { loadEffectiveConfig } from "../../server/settings/load.ts";
import { SettingsService } from "../../server/settings/service.ts";
import { SqliteSettingsStore } from "../../server/settings/store.ts";
import type { AssignmentInput } from "../../shared/classroom.ts";
import { fakeOpenDataFetch } from "./openDataFetch.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const assignment: AssignmentInput = {
  title: "Kyoto: Curiosity",
  destination: { lat: 35.0116, lng: 135.7681, label: "Kyoto", country: "Japan", postcardId: "kyoto", source: "postcard" },
  focusSkill: "curiosity",
};

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function tempFile(name = "common-ground.db"): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "life-sqlite-")), name);
}

/** A connection to the file, as one server process would have. */
async function connect(file: string): Promise<Extract<Database, { kind: "sqlite" }>> {
  const db = await openDatabase(`sqlite:${file}`, { connections: 1, log: () => {} });
  if (db.kind !== "sqlite") throw new Error("expected SQLite");
  cleanups.push(() => db.close());
  return db;
}

/** Runs `code` in another Node process, which can import the server's modules by path; resolves with its output. */
function inProcess(code: string, env: Record<string, string> = {}, onLine?: (line: string) => void): Promise<string> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, ["--no-warnings", "--input-type=module", "-e", code], { cwd: ROOT, env: { ...process.env, ...env } });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      for (const line of chunk.toString().split("\n").filter(Boolean)) onLine?.(line);
    });
    child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString()));
    child.on("error", fail);
    child.on("close", (status) => (status === 0 ? done(out) : fail(new Error(`exit ${status}: ${err}`))));
  });
}

describe("DATABASE_URL", () => {
  it("names Postgres or a SQLite file", () => {
    expect(parseDatabaseUrl("postgres://u:p@db/cg")).toEqual({ kind: "postgres", url: "postgres://u:p@db/cg" });
    expect(parseDatabaseUrl("postgresql://db/cg").kind).toBe("postgres");
    expect(parseDatabaseUrl("sqlite:data/common-ground.db")).toEqual({ kind: "sqlite", file: "data/common-ground.db" });
    expect(parseDatabaseUrl("sqlite://data/common-ground.db")).toEqual({ kind: "sqlite", file: "data/common-ground.db" });
    expect(parseDatabaseUrl("sqlite:///var/lib/common-ground.db")).toEqual({ kind: "sqlite", file: "/var/lib/common-ground.db" });
    expect(() => parseDatabaseUrl("sqlite:")).toThrow(/needs a file/);
    expect(() => parseDatabaseUrl("sqlite::memory:")).toThrow(/needs a file/);
  });

  it("says what's wrong with any other URL without repeating its password", () => {
    expect(() => parseDatabaseUrl("mysql://root:hunter2@db/cg")).toThrow(/starts with "mysql"/);
    expect(() => parseDatabaseUrl("mysql://root:hunter2@db/cg")).not.toThrow(/hunter2/);
  });
});

describe("the SQLite store", () => {
  it("makes a file only the server's user can read, folders and all", async () => {
    const file = join(await tempFile(), "..", "nested", "common-ground.db");
    const db = await connect(file);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    // Write-ahead logging: readers don't wait for a writer. Its log gets the file's permissions.
    expect(db.sqlite.prepare("PRAGMA journal_mode").get()).toMatchObject({ journal_mode: "wal" });
    const store = await SqliteSettingsStore.open(db.sqlite);
    await store.save({ AI_API_KEY: "sk-secret" });
    expect((await stat(`${file}-wal`)).mode & 0o777).toBe(0o600);
  });

  it("keeps settings with a revision, refusing a save made against an old one", async () => {
    const file = await tempFile();
    const store = await SqliteSettingsStore.open((await connect(file)).sqlite);
    expect(store.kind).toBe("sqlite");
    expect(store.current()).toMatchObject({ revision: 0, values: {} });
    const saved = await store.save({ ACCESS_CODE: "maple" }, 0);
    expect(saved).toMatchObject({ revision: 1, values: { ACCESS_CODE: "maple" } });
    await expect(store.save({ ACCESS_CODE: "oak" }, 0)).rejects.toMatchObject({ status: 409 });
    // One generated key: a second "only if missing" loses.
    expect(await store.setAdminKeyHash("a".repeat(64), true)).toBe(true);
    expect(await store.setAdminKeyHash("b".repeat(64), true)).toBe(false);
    expect(store.current().adminKeyHash).toBe("a".repeat(64));
    // Reopened, as after a restart.
    const again = await SqliteSettingsStore.open((await connect(file)).sqlite);
    expect(again.current()).toMatchObject({ revision: 1, values: { ACCESS_CODE: "maple" }, adminKeyHash: "a".repeat(64) });
  });

  it("runs a class across two connections without losing anyone's changes", async () => {
    const file = await tempFile();
    const one = await ClassroomStore.openShared(await connect(file));
    const two = await ClassroomStore.openShared(await connect(file));
    expect(one.kind).toBe("sqlite");
    const { code, teacherKey } = await one.create("7C", "Mr Sato");
    const a = await two.addAssignment(code, teacherKey, assignment);
    const joins = await Promise.all(Array.from({ length: 30 }, (_, i) => (i % 2 ? one : two).join(code, `Student ${i}`)));
    await Promise.all(
      joins.map((j, i) =>
        (i % 2 ? two : one).submit(code, {
          studentId: j.studentId,
          assignmentId: a.id,
          kind: "local",
          with: "Haruka",
          headline: "Good questions.",
          scores: { curiosity: i % 5 },
          growthSkill: "listening",
          goalAchieved: i % 2 === 0,
          selfRating: 3,
          calibrationGap: 0,
          xp: 50,
        }),
      ),
    );
    const dashboard = await one.dashboard(code.toLowerCase(), teacherKey);
    expect(dashboard.students).toHaveLength(30);
    expect(dashboard.assignments[0]).toMatchObject({ completed: 30, goalRate: 50 });
    await expect(two.dashboard(code, "guess")).rejects.toMatchObject({ status: 403 });
    await expect(two.view("NOPE22")).rejects.toMatchObject({ status: 404 });
    // A refused change is rolled back, and the connection is ready for the next.
    await expect(one.addAssignment(code, "guess", assignment)).rejects.toMatchObject({ status: 403 });
    expect((await two.view(code)).assignments).toHaveLength(1);
    await one.join(code, "Late");
    expect((await one.dashboard(code, teacherKey)).students).toHaveLength(31);
  });

  it("lets two processes join students to one class at the same time, all recorded", { timeout: 30_000 }, async () => {
    const file = await tempFile();
    const store = await ClassroomStore.openShared(await connect(file));
    const { code, teacherKey } = await store.create("8B", "Ms Okafor");
    const joinAll = (who: string) => `
      for (let i = 0; i < 25; i++) {
        await store.join(${JSON.stringify(code)}, \`${who} \${i}\`);
        await new Promise((r) => setTimeout(r, 2));
      }`;
    let ready!: () => void;
    const started = new Promise<void>((r) => (ready = r));
    const child = inProcess(
      `import { openDatabase } from "./server/db.ts";
       import { ClassroomStore } from "./server/classroom/store.ts";
       const store = await ClassroomStore.openShared(await openDatabase(${JSON.stringify(`sqlite:${file}`)}, { connections: 1, log: () => {} }));
       console.log("ready");
       ${joinAll("Child")}
       console.log("done");`,
      {},
      (line) => line === "ready" && ready(),
    );
    await started;
    for (let i = 0; i < 25; i++) {
      await store.join(code, `Parent ${i}`);
      await new Promise((r) => setTimeout(r, 2));
    }
    expect(await child).toContain("done");
    const names = (await store.dashboard(code, teacherKey)).students.map((s) => s.name);
    expect(names).toHaveLength(50);
    expect(names.filter((n) => n.startsWith("Child"))).toHaveLength(25);
  });

  it("applies settings saved by one process in another, without a restart", async () => {
    const file = await tempFile();
    const env = { ADMIN_KEY: "" };
    const start = async () => {
      const db = await connect(file);
      const store = await SqliteSettingsStore.open(db.sqlite, () => {}, 25);
      const runtime = await Runtime.start(loadConfig({}, []), { log: () => {}, createAI: () => new DemoGameAI({ typingDelayMs: 0 }), fetchImpl: fakeOpenDataFetch(), db });
      const settings = new SettingsService({ store, runtime, processEnv: env, log: () => {} });
      settings.watch();
      cleanups.push(() => settings.close(), () => runtime.close(), () => store.close());
      return { store, runtime, settings };
    };
    const a = await start();
    const b = await start();
    expect(a.runtime.current.classroom?.kind).toBe("sqlite");
    expect(a.settings.view().storage).toBe("sqlite");

    // One key for the pair: whoever starts first makes it.
    const keys = await Promise.all([a.settings.ensureKey(), b.settings.ensureKey()]);
    expect(keys.filter(Boolean)).toHaveLength(1);
    const key = keys.find(Boolean)!;
    expect(a.settings.verify(key) && b.settings.verify(key)).toBe(true);

    await a.settings.update({ values: { ACCESS_CODE: "maple", CLASSROOM: "off" }, revision: 0 });
    await vi.waitFor(() => expect(b.runtime.current.config.accessCode).toBe("maple"), { timeout: 5_000 });
    expect(b.runtime.current.classroom).toBeUndefined();
    // B's form was loaded before A saved: its save is refused rather than overwriting A's.
    await expect(b.settings.update({ values: { ACCESS_CODE: "oak" }, revision: 0 })).rejects.toMatchObject({ status: 409 });
    expect(b.settings.view().settings.ACCESS_CODE).toMatchObject({ source: "page", value: "maple" });
  });

  it("hears a new key from the key script, and gives scripts the saved settings", { timeout: 30_000 }, async () => {
    const file = await tempFile();
    const url = `sqlite:${file}`;
    const db = await connect(file);
    const store = await SqliteSettingsStore.open(db.sqlite, () => {}, 25);
    const runtime = await Runtime.start(loadConfig({}, []), { log: () => {}, createAI: () => new DemoGameAI({ typingDelayMs: 0 }), fetchImpl: fakeOpenDataFetch(), db });
    const settings = new SettingsService({ store, runtime, processEnv: {}, log: () => {} });
    settings.watch();
    cleanups.push(() => settings.close(), () => runtime.close(), () => store.close());
    const first = await settings.ensureKey();
    expect(first).toBeTruthy();
    await settings.update({ values: { ACCESS_CODE: "maple" } });

    const out = await inProcess("await import('./scripts/settings-key.ts');", { DATABASE_URL: url, ADMIN_KEY: "", DATA_DIR: join(file, "..", "unused") });
    const key = /New settings page key: (\S+)/.exec(out)?.[1];
    expect(key).toBeTruthy();
    await vi.waitFor(() => expect(settings.verify(key)).toBe(true), { timeout: 5_000 });
    expect(settings.verify(first!)).toBe(false);

    const config = await loadEffectiveConfig({ DATABASE_URL: url });
    expect(config.accessCode).toBe("maple");
  });
});
