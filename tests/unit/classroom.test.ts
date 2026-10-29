// Classroom mode: classes survive a restart, only the teacher sees the class debrief, and students
// share summaries (their ids, which act as credentials, never leave the server).
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AssignmentInput, ClassResultInput } from "../../shared/classroom.ts";
import { ClassroomStore } from "../../server/classroom/store.ts";
import { HttpError } from "../../server/util/errors.ts";

const assignment: AssignmentInput = {
  title: "Nairobi: Listening",
  destination: { lat: -1.2841, lng: 36.8235, label: "Nairobi", country: "Kenya", postcardId: "nairobi", source: "postcard" },
  focusSkill: "listening",
};

const result = (studentId: string, assignmentId: string, patch: Partial<ClassResultInput> = {}): ClassResultInput => ({
  studentId,
  assignmentId,
  kind: "local",
  with: "Wanjiru",
  headline: "You earned Wanjiru's trust.",
  scores: { listening: 3, curiosity: 2, empathy: null },
  growthSkill: "empathy",
  goalAchieved: true,
  selfRating: 4,
  calibrationGap: 0.5,
  xp: 80,
  ...patch,
});

describe("ClassroomStore", () => {
  it("runs a class: assignments, students, results and the class debrief", async () => {
    const dir = await mkdtemp(join(tmpdir(), "life-classes-"));
    const store = await ClassroomStore.open(dir);
    const { code, teacherKey } = store.create("9B", "Ms Rivera");
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    const a = store.addAssignment(code, teacherKey, assignment);
    const lin = store.join(code.toLowerCase(), "Lin");
    const sam = store.join(code, "Sam");
    expect(lin.view.assignments).toEqual([a]);

    store.submit(code, result(lin.studentId, a.id));
    store.submit(code, result(sam.studentId, a.id, { scores: { listening: 1 }, goalAchieved: false, growthSkill: "listening", calibrationGap: 2 }));
    // A second attempt replaces the first.
    store.submit(code, result(lin.studentId, a.id, { scores: { listening: 4, curiosity: 2 }, calibrationGap: 0 }));

    const dashboard = store.dashboard(code, teacherKey);
    expect(dashboard.students.map((s) => s.name)).toEqual(["Lin", "Sam"]);
    const [summary] = dashboard.assignments;
    expect(summary).toMatchObject({ completed: 2, goalRate: 50, averageCalibration: 1 });
    expect(summary!.averageScores).toMatchObject({ listening: 2.5, curiosity: 2, empathy: null });
    expect(summary!.commonGrowth).toEqual([
      { skill: "listening", count: 1 },
      { skill: "empathy", count: 1 },
    ]);
    expect(JSON.stringify(dashboard)).not.toContain(lin.studentId);

    // Survives a restart.
    await store.flush();
    const reopened = await ClassroomStore.open(dir);
    expect(reopened.dashboard(code, teacherKey).assignments[0]!.completed).toBe(2);
  });

  it("keeps the class debrief and assignments to the teacher, and results to members", async () => {
    const store = await ClassroomStore.open(await mkdtemp(join(tmpdir(), "life-classes-")));
    const { code, teacherKey } = store.create("9B", "Ms Rivera");
    const a = store.addAssignment(code, teacherKey, assignment);
    const status = (fn: () => unknown) => {
      try {
        fn();
        return 0;
      } catch (error) {
        return (error as HttpError).status;
      }
    };
    expect(status(() => store.dashboard(code, "guess"))).toBe(403);
    expect(status(() => store.dashboard(code, undefined))).toBe(403);
    expect(status(() => store.addAssignment(code, "guess", assignment))).toBe(403);
    expect(status(() => store.view("NOPE00"))).toBe(404);
    expect(status(() => store.submit(code, result("not-a-member-id", a.id)))).toBe(403);
    const lin = store.join(code, "Lin");
    expect(status(() => store.submit(code, result(lin.studentId, "as_gone")))).toBe(404);
    store.removeAssignment(code, teacherKey, a.id);
    expect(store.view(code).assignments).toEqual([]);
  });
});
