// Classroom mode: classes, their assignments and students' results, kept in one JSON file under
// DATA_DIR. Small by design (a class is a few dozen students), so the whole store lives in memory
// and is written atomically (temp file, then rename) shortly after each change. A teacher's key is
// shown once and kept only as a hash; students get an unguessable id. Results are summaries
// (scores, the mentor's headline): conversations never leave the student's browser.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SKILL_IDS, type SkillId } from "../../shared/skills.ts";
import type { Assignment, AssignmentInput, ClassDashboard, ClassResult, ClassResultInput, StudentClassView } from "../../shared/classroom.ts";
import { HttpError } from "../util/errors.ts";

interface Student {
  id: string;
  name: string;
  joinedAt: number;
}

/** A student's id is their credential, so it stays on the server. */
interface StoredResult extends ClassResult {
  studentId: string;
}

interface ClassRecord {
  code: string;
  name: string;
  teacherName: string;
  teacherKeyHash: string;
  createdAt: number;
  assignments: Assignment[];
  students: Student[];
  results: StoredResult[];
}

export const CLASS_LIMITS = { classes: 2000, students: 200, assignments: 50, results: 5000 };

/** Codes avoid look-alike characters (0/O, 1/I/L), so they survive being read aloud or written on a board. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const hash = (key: string) => createHash("sha256").update(key).digest("hex");
const randomCode = () => Array.from(randomBytes(6), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
const randomToken = (bytes: number) => randomBytes(bytes).toString("base64url");

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export class ClassroomStore {
  readonly #file: string;
  readonly #classes = new Map<string, ClassRecord>();
  #saving: Promise<void> = Promise.resolve();
  #timer: ReturnType<typeof setTimeout> | null = null;

  private constructor(file: string) {
    this.#file = file;
  }

  /** Load the store from `dir` (created if missing). */
  static async open(dir: string): Promise<ClassroomStore> {
    await mkdir(dir, { recursive: true });
    const store = new ClassroomStore(join(dir, "classrooms.json"));
    try {
      const data = JSON.parse(await readFile(store.#file, "utf8")) as { classes?: ClassRecord[] };
      for (const record of data.classes ?? []) store.#classes.set(record.code, record);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return store;
  }

  /** Write soon after a change; several changes in quick succession become one write. */
  #changed(): void {
    if (this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.flush();
    }, 200);
  }

  async flush(): Promise<void> {
    const data = JSON.stringify({ classes: [...this.#classes.values()] });
    this.#saving = this.#saving.then(async () => {
      const tmp = `${this.#file}.${process.pid}.tmp`;
      await writeFile(tmp, data, { mode: 0o600 });
      await rename(tmp, this.#file);
    });
    return this.#saving;
  }

  #get(code: string): ClassRecord {
    const record = this.#classes.get(code.trim().toUpperCase());
    if (!record) throw new HttpError(404, "class_not_found", "There's no class with that code. Check it with your teacher.");
    return record;
  }

  #teacher(code: string, key: string | undefined): ClassRecord {
    const record = this.#get(code);
    if (!key || !sameHash(hash(key), record.teacherKeyHash)) throw new HttpError(403, "not_teacher", "Only the teacher who created this class can see that.");
    return record;
  }

  create(name: string, teacherName: string): { code: string; teacherKey: string } {
    if (this.#classes.size >= CLASS_LIMITS.classes) throw new HttpError(507, "classes_full", "This server can't hold more classes.");
    let code = randomCode();
    while (this.#classes.has(code)) code = randomCode();
    const teacherKey = randomToken(24);
    this.#classes.set(code, { code, name, teacherName, teacherKeyHash: hash(teacherKey), createdAt: Date.now(), assignments: [], students: [], results: [] });
    this.#changed();
    return { code, teacherKey };
  }

  view(code: string): StudentClassView {
    const record = this.#get(code);
    return { code: record.code, name: record.name, teacherName: record.teacherName, assignments: record.assignments };
  }

  join(code: string, name: string): { studentId: string; view: StudentClassView } {
    const record = this.#get(code);
    if (record.students.length >= CLASS_LIMITS.students) throw new HttpError(409, "class_full", "This class is full.");
    const student = { id: randomToken(18), name, joinedAt: Date.now() };
    record.students.push(student);
    this.#changed();
    return { studentId: student.id, view: this.view(code) };
  }

  addAssignment(code: string, key: string | undefined, input: AssignmentInput): Assignment {
    const record = this.#teacher(code, key);
    if (record.assignments.length >= CLASS_LIMITS.assignments) throw new HttpError(409, "assignments_full", "Remove an old assignment first.");
    const assignment: Assignment = { id: `as_${randomToken(6)}`, createdAt: Date.now(), ...input };
    record.assignments.push(assignment);
    this.#changed();
    return assignment;
  }

  removeAssignment(code: string, key: string | undefined, id: string): void {
    const record = this.#teacher(code, key);
    record.assignments = record.assignments.filter((a) => a.id !== id);
    record.results = record.results.filter((r) => r.assignmentId !== id);
    this.#changed();
  }

  /** A student's result for an assignment; a later attempt replaces an earlier one. */
  submit(code: string, input: ClassResultInput): void {
    const record = this.#get(code);
    const student = record.students.find((s) => s.id === input.studentId);
    if (!student) throw new HttpError(403, "not_in_class", "Join the class again to share your results.");
    if (!record.assignments.some((a) => a.id === input.assignmentId)) throw new HttpError(404, "assignment_gone", "Your teacher removed that assignment.");
    record.results = record.results.filter((r) => !(r.studentId === student.id && r.assignmentId === input.assignmentId));
    if (record.results.length >= CLASS_LIMITS.results) record.results.shift();
    const { studentId: _id, ...summary } = input;
    record.results.push({ ...summary, studentId: student.id, studentName: student.name, at: Date.now() });
    this.#changed();
  }

  /** The class debrief view: per assignment, who finished and how the class did. */
  dashboard(code: string, key: string | undefined): ClassDashboard {
    const record = this.#teacher(code, key);
    return {
      code: record.code,
      name: record.name,
      teacherName: record.teacherName,
      students: record.students.map((s) => ({ name: s.name, joinedAt: s.joinedAt })),
      assignments: record.assignments.map((assignment) => {
        const results = record.results.filter((r) => r.assignmentId === assignment.id);
        const average = (values: number[]) => (values.length ? Math.round((values.reduce((x, y) => x + y, 0) / values.length) * 10) / 10 : null);
        const skills = Object.fromEntries(
          SKILL_IDS.map((id) => [id, average(results.map((r) => r.scores[id]).filter((v): v is number => typeof v === "number"))]),
        ) as Record<SkillId, number | null>;
        const growth = new Map<SkillId, number>();
        for (const r of results) growth.set(r.growthSkill, (growth.get(r.growthSkill) ?? 0) + 1);
        const gaps = results.map((r) => r.calibrationGap).filter((g): g is number => typeof g === "number");
        return {
          assignment,
          completed: results.length,
          goalRate: results.length ? Math.round((results.filter((r) => r.goalAchieved).length / results.length) * 100) : null,
          averageScores: skills,
          commonGrowth: [...growth.entries()].sort((a, b) => b[1] - a[1] || SKILL_IDS.indexOf(a[0]) - SKILL_IDS.indexOf(b[0])).map(([skill, count]) => ({ skill, count })),
          averageCalibration: average(gaps),
          results: [...results].sort((a, b) => b.at - a.at).map(({ studentId: _id, ...result }) => result),
        };
      }),
    };
  }
}
