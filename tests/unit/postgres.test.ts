// The shared store, against a real Postgres (TEST_DATABASE_URL; skipped without one). Two
// "instances" share one database: classes don't lose each other's changes, settings saved on
// one apply on the other without a restart, and only one of them makes the settings key.
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { DemoGameAI } from "../../server/ai/demo.ts";
import { ClassroomStore } from "../../server/classroom/store.ts";
import { loadConfig } from "../../server/config.ts";
import { openDatabase, type Database } from "../../server/db.ts";
import { Runtime } from "../../server/runtime.ts";
import { SettingsService } from "../../server/settings/service.ts";
import { openSettingsStore } from "../../server/settings/store.ts";
import type { AssignmentInput } from "../../shared/classroom.ts";
import { fakeOpenDataFetch } from "./openDataFetch.ts";

const adminUrl = process.env.TEST_DATABASE_URL;
const assignment: AssignmentInput = {
  title: "Kyoto: Curiosity",
  destination: { lat: 35.0116, lng: 135.7681, label: "Kyoto", country: "Japan", postcardId: "kyoto", source: "postcard" },
  focusSkill: "curiosity",
};

describe.skipIf(!adminUrl)("the shared Postgres store", () => {
  const name = `life_test_${randomBytes(4).toString("hex")}`;
  let url = "";
  const dbs: Database[] = [];
  const database = async () => {
    const db = await openDatabase(url, { connections: 5, log: () => {} });
    dbs.push(db);
    return db;
  };

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    const parsed = new URL(adminUrl!);
    parsed.pathname = `/${name}`;
    url = parsed.toString();
  });

  afterAll(async () => {
    await Promise.all(dbs.map((db) => db.close()));
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  });

  it("runs a class across two instances without losing anyone's changes", async () => {
    const one = await ClassroomStore.openShared(await database());
    const two = await ClassroomStore.openShared(await database());
    expect(one.kind).toBe("postgres");
    const { code, teacherKey } = await one.create("7C", "Mr Sato");
    const a = await two.addAssignment(code, teacherKey, assignment);
    // Thirty students join at once, half through each instance.
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
    // A refused change leaves the class as it was.
    await expect(one.addAssignment(code, "guess", assignment)).rejects.toMatchObject({ status: 403 });
    expect((await two.view(code)).assignments).toHaveLength(1);
  });

  it("applies settings saved on one instance on the other, without a restart", async () => {
    const env = { ADMIN_KEY: "" };
    const start = async () => {
      const db = await database();
      const store = await openSettingsStore(db, "unused");
      expect(store.kind).toBe("postgres");
      const runtime = await Runtime.start(loadConfig({}, []), { log: () => {}, createAI: () => new DemoGameAI({ typingDelayMs: 0 }), fetchImpl: fakeOpenDataFetch(), db });
      const settings = new SettingsService({ store, runtime, processEnv: env, log: () => {} });
      settings.watch();
      return { store, runtime, settings };
    };
    const a = await start();
    const b = await start();
    expect(a.runtime.current.classroom?.kind).toBe("postgres");

    // One key for the pair: whoever starts first makes it.
    const keys = await Promise.all([a.settings.ensureKey(), b.settings.ensureKey()]);
    expect(keys.filter(Boolean)).toHaveLength(1);
    const key = keys.find(Boolean)!;
    await vi.waitFor(() => expect(b.settings.verify(key)).toBe(true));
    expect(a.settings.verify(key)).toBe(true);

    await a.settings.update({ values: { ACCESS_CODE: "maple", CLASSROOM: "off" }, revision: 0 });
    await vi.waitFor(() => expect(b.runtime.current.config.accessCode).toBe("maple"), { timeout: 5_000 });
    expect(b.runtime.current.classroom).toBeUndefined();
    // B's form was loaded before A saved: its save is refused rather than overwriting A's.
    await expect(b.settings.update({ values: { ACCESS_CODE: "oak" }, revision: 0 })).rejects.toMatchObject({ status: 409 });
    expect(b.settings.view().settings.ACCESS_CODE).toMatchObject({ source: "page", value: "maple" });

    for (const side of [a, b]) {
      side.settings.close();
      await side.runtime.close();
      await side.store.close();
    }
  });
});
