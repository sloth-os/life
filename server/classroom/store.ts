// Classroom mode: classes, their assignments and students' results. One server instance keeps
// them in a JSON file under DATA_DIR: the whole store lives in memory and is written atomically
// (temp file, then rename) shortly after each change. Several instances share Postgres
// (DATABASE_URL) instead, where each change locks its class's row, so instances can't overwrite
// each other. A teacher's key is shown once and kept only as a hash; students get an unguessable
// id. Results are summaries (scores, the mentor's headline): conversations never leave the
// student's browser.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type pg from "pg";
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

export interface ClassRecord {
  code: string;
  name: string;
  teacherName: string;
  teacherKeyHash: string;
  createdAt: number;
  assignments: Assignment[];
  students: Student[];
  results: StoredResult[];
}

/** Where classes are kept. `update` changes one class atomically and returns what `change` does. */
export interface ClassBackend {
  readonly kind: "file" | "postgres";
  count(): Promise<number>;
  get(code: string): Promise<ClassRecord | undefined>;
  /** False when the code is taken. */
  insert(record: ClassRecord): Promise<boolean>;
  update<T>(code: string, change: (record: ClassRecord) => T): Promise<T>;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export const CLASS_LIMITS = { classes: 2000, students: 200, assignments: 50, results: 5000 };

/** Codes avoid look-alike characters (0/O, 1/I/L), so they survive being read aloud or written on a board. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const hash = (key: string) => createHash("sha256").update(key).digest("hex");
const randomCode = () => Array.from(randomBytes(6), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
const randomToken = (bytes: number) => randomBytes(bytes).toString("base64url");
const normalizeCode = (code: string) => code.trim().toUpperCase();

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const notFound = () => new HttpError(404, "class_not_found", "There's no class with that code. Check it with your teacher.");

function checkTeacher(record: ClassRecord, key: string | undefined): void {
  if (!key || !sameHash(hash(key), record.teacherKeyHash)) throw new HttpError(403, "not_teacher", "Only the teacher who created this class can see that.");
}

/** All classes in memory, written to `dir/classrooms.json` shortly after each change. */
export class FileClassBackend implements ClassBackend {
  readonly kind = "file" as const;
  readonly #file: string;
  readonly #classes = new Map<string, ClassRecord>();
  #saving: Promise<void> = Promise.resolve();
  #timer: ReturnType<typeof setTimeout> | null = null;

  private constructor(file: string) {
    this.#file = file;
  }

  static async open(dir: string): Promise<FileClassBackend> {
    await mkdir(dir, { recursive: true });
    const backend = new FileClassBackend(join(dir, "classrooms.json"));
    try {
      const data = JSON.parse(await readFile(backend.#file, "utf8")) as { classes?: ClassRecord[] };
      for (const record of data.classes ?? []) backend.#classes.set(record.code, record);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return backend;
  }

  /** Write soon after a change; several changes in quick succession become one write. */
  #changed(): void {
    if (this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.flush();
    }, 200);
  }

  async count(): Promise<number> {
    return this.#classes.size;
  }

  async get(code: string): Promise<ClassRecord | undefined> {
    return this.#classes.get(code);
  }

  async insert(record: ClassRecord): Promise<boolean> {
    if (this.#classes.has(record.code)) return false;
    this.#classes.set(record.code, record);
    this.#changed();
    return true;
  }

  async update<T>(code: string, change: (record: ClassRecord) => T): Promise<T> {
    const record = this.#classes.get(code);
    if (!record) throw notFound();
    // Change a copy, so a refused change leaves the class as it was.
    const copy = structuredClone(record);
    const result = change(copy);
    this.#classes.set(code, copy);
    this.#changed();
    return result;
  }

  async flush(): Promise<void> {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    const data = JSON.stringify({ classes: [...this.#classes.values()] });
    this.#saving = this.#saving.then(async () => {
      const tmp = `${this.#file}.${process.pid}.tmp`;
      await writeFile(tmp, data, { mode: 0o600 });
      await rename(tmp, this.#file);
    });
    return this.#saving;
  }

  close(): Promise<void> {
    return this.flush();
  }
}

/** One row per class in Postgres, locked while it changes. */
export class PostgresClassBackend implements ClassBackend {
  readonly kind = "postgres" as const;
  readonly #pool: pg.Pool;

  private constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  static async open(pool: pg.Pool): Promise<PostgresClassBackend> {
    await pool.query(`CREATE TABLE IF NOT EXISTS common_ground_classes (
      code text PRIMARY KEY,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    return new PostgresClassBackend(pool);
  }

  async count(): Promise<number> {
    const { rows } = await this.#pool.query<{ n: string }>("SELECT count(*) AS n FROM common_ground_classes");
    return Number(rows[0]?.n ?? 0);
  }

  async get(code: string): Promise<ClassRecord | undefined> {
    const { rows } = await this.#pool.query<{ data: ClassRecord }>("SELECT data FROM common_ground_classes WHERE code = $1", [code]);
    return rows[0]?.data;
  }

  async insert(record: ClassRecord): Promise<boolean> {
    const { rowCount } = await this.#pool.query("INSERT INTO common_ground_classes (code, data) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING", [record.code, JSON.stringify(record)]);
    return Boolean(rowCount);
  }

  async update<T>(code: string, change: (record: ClassRecord) => T): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<{ data: ClassRecord }>("SELECT data FROM common_ground_classes WHERE code = $1 FOR UPDATE", [code]);
      if (!rows[0]) throw notFound();
      const record = rows[0].data;
      const result = change(record);
      await client.query("UPDATE common_ground_classes SET data = $2, updated_at = now() WHERE code = $1", [code, JSON.stringify(record)]);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async flush(): Promise<void> {}

  async close(): Promise<void> {}
}

export class ClassroomStore {
  readonly #backend: ClassBackend;

  constructor(backend: ClassBackend) {
    this.#backend = backend;
  }

  /** Classes in a JSON file under `dir` (created if missing): one server instance. */
  static async open(dir: string): Promise<ClassroomStore> {
    return new ClassroomStore(await FileClassBackend.open(dir));
  }

  /** Classes in Postgres, shared by every instance using the same database. */
  static async openShared(pool: pg.Pool): Promise<ClassroomStore> {
    return new ClassroomStore(await PostgresClassBackend.open(pool));
  }

  get kind(): ClassBackend["kind"] {
    return this.#backend.kind;
  }

  flush(): Promise<void> {
    return this.#backend.flush();
  }

  close(): Promise<void> {
    return this.#backend.close();
  }

  async #get(code: string): Promise<ClassRecord> {
    const record = await this.#backend.get(normalizeCode(code));
    if (!record) throw notFound();
    return record;
  }

  async create(name: string, teacherName: string): Promise<{ code: string; teacherKey: string }> {
    if ((await this.#backend.count()) >= CLASS_LIMITS.classes) throw new HttpError(507, "classes_full", "This server can't hold more classes.");
    const teacherKey = randomToken(24);
    for (;;) {
      const code = randomCode();
      const record: ClassRecord = { code, name, teacherName, teacherKeyHash: hash(teacherKey), createdAt: Date.now(), assignments: [], students: [], results: [] };
      if (await this.#backend.insert(record)) return { code, teacherKey };
    }
  }

  async view(code: string): Promise<StudentClassView> {
    return studentView(await this.#get(code));
  }

  join(code: string, name: string): Promise<{ studentId: string; view: StudentClassView }> {
    return this.#backend.update(normalizeCode(code), (record) => {
      if (record.students.length >= CLASS_LIMITS.students) throw new HttpError(409, "class_full", "This class is full.");
      const student = { id: randomToken(18), name, joinedAt: Date.now() };
      record.students.push(student);
      return { studentId: student.id, view: studentView(record) };
    });
  }

  addAssignment(code: string, key: string | undefined, input: AssignmentInput): Promise<Assignment> {
    return this.#backend.update(normalizeCode(code), (record) => {
      checkTeacher(record, key);
      if (record.assignments.length >= CLASS_LIMITS.assignments) throw new HttpError(409, "assignments_full", "Remove an old assignment first.");
      const assignment: Assignment = { id: `as_${randomToken(6)}`, createdAt: Date.now(), ...input };
      record.assignments.push(assignment);
      return assignment;
    });
  }

  removeAssignment(code: string, key: string | undefined, id: string): Promise<void> {
    return this.#backend.update(normalizeCode(code), (record) => {
      checkTeacher(record, key);
      record.assignments = record.assignments.filter((a) => a.id !== id);
      record.results = record.results.filter((r) => r.assignmentId !== id);
    });
  }

  /** A student's result for an assignment; a later attempt replaces an earlier one. */
  submit(code: string, input: ClassResultInput): Promise<void> {
    return this.#backend.update(normalizeCode(code), (record) => {
      const student = record.students.find((s) => s.id === input.studentId);
      if (!student) throw new HttpError(403, "not_in_class", "Join the class again to share your results.");
      if (!record.assignments.some((a) => a.id === input.assignmentId)) throw new HttpError(404, "assignment_gone", "Your teacher removed that assignment.");
      record.results = record.results.filter((r) => !(r.studentId === student.id && r.assignmentId === input.assignmentId));
      if (record.results.length >= CLASS_LIMITS.results) record.results.shift();
      const { studentId: _id, ...summary } = input;
      record.results.push({ ...summary, studentId: student.id, studentName: student.name, at: Date.now() });
    });
  }

  /** The class debrief view: per assignment, who finished and how the class did. */
  async dashboard(code: string, key: string | undefined): Promise<ClassDashboard> {
    const record = await this.#get(code);
    checkTeacher(record, key);
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

function studentView(record: ClassRecord): StudentClassView {
  return { code: record.code, name: record.name, teacherName: record.teacherName, assignments: record.assignments };
}
