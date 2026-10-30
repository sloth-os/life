// Where values saved on the settings page are kept: a JSON file under DATA_DIR (one instance), or
// the database DATABASE_URL names: Postgres, which several instances share, or a SQLite file. Each
// tells the server when the settings change behind its back, so it applies them without a restart:
// an edit to the file, another instance saving (Postgres LISTEN/NOTIFY), or another process writing
// to the SQLite file.
import { createHash } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import type pg from "pg";
import type { StoreKind } from "../../shared/settings.ts";
import type { Database } from "../db.ts";
import { HttpError } from "../util/errors.ts";

export interface StoredSettings {
  revision: number;
  updatedAt: number | null;
  values: Record<string, string>;
  /** The hash of the key the server generated for the settings page (when ADMIN_KEY isn't set). */
  adminKeyHash?: string;
}

export interface SettingsStore {
  readonly kind: StoreKind;
  current(): StoredSettings;
  /** Save new values. With `revision`, refuse (409) if someone else saved since. */
  save(values: Record<string, string>, revision?: number): Promise<StoredSettings>;
  /** Keep a generated key's hash; with `onlyIfMissing`, false if another instance got there first. */
  setAdminKeyHash(hash: string, onlyIfMissing: boolean): Promise<boolean>;
  /** Called when the settings change elsewhere: the file edited, or another instance or process saving. */
  onExternalChange(listener: (settings: StoredSettings) => void): void;
  close(): Promise<void>;
}

const EMPTY: StoredSettings = { revision: 0, updatedAt: null, values: {} };

/** The store DATABASE_URL names, or settings.json under DATA_DIR without one. */
export function openSettingsStore(db: Database | undefined, dataDir: string, log: (message: string) => void = () => {}): Promise<SettingsStore> {
  if (db?.kind === "postgres") return PostgresSettingsStore.open(db.pool, log);
  if (db?.kind === "sqlite") return SqliteSettingsStore.open(db.sqlite, log);
  return FileSettingsStore.open(dataDir, log);
}

function normalize(raw: unknown): StoredSettings {
  const data = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<StoredSettings>;
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(data.values ?? {})) if (typeof value === "string") values[key] = value;
  return {
    revision: Number.isInteger(data.revision) ? data.revision! : 0,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : null,
    values,
    adminKeyHash: typeof data.adminKeyHash === "string" ? data.adminKeyHash : undefined,
  };
}

const conflict = () => new HttpError(409, "settings_conflict", "The settings were changed somewhere else in the meantime. Reload them and try again.");

/** settings.json under DATA_DIR, written atomically and readable only by the server's user. */
export class FileSettingsStore implements SettingsStore {
  readonly kind = "file" as const;
  readonly #dir: string;
  readonly #file: string;
  #settings: StoredSettings = EMPTY;
  /** A hash of what is on disk as far as we know, so our own writes don't count as outside edits. */
  #digest = "";
  #watcher: FSWatcher | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #writing: Promise<unknown> = Promise.resolve();
  readonly #listeners: ((settings: StoredSettings) => void)[] = [];
  readonly #log: (message: string) => void;

  private constructor(dir: string, log: (message: string) => void) {
    this.#dir = dir;
    this.#file = join(dir, "settings.json");
    this.#log = log;
  }

  static async open(dir: string, log: (message: string) => void = () => {}): Promise<FileSettingsStore> {
    await mkdir(dir, { recursive: true });
    const store = new FileSettingsStore(dir, log);
    const text = await readFile(store.#file, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (text !== null) {
      store.#settings = normalize(JSON.parse(text));
      store.#digest = digest(text);
    }
    return store;
  }

  current(): StoredSettings {
    return this.#settings;
  }

  /** One change at a time, so two saves can't both start from the same settings. */
  #serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.#writing.then(work);
    this.#writing = run.catch(() => {});
    return run;
  }

  async #write(next: StoredSettings): Promise<void> {
    const text = `${JSON.stringify(next, null, 2)}\n`;
    const tmp = `${this.#file}.${process.pid}.tmp`;
    await writeFile(tmp, text, { mode: 0o600 });
    this.#digest = digest(text);
    await rename(tmp, this.#file);
    this.#settings = next;
  }

  save(values: Record<string, string>, revision?: number): Promise<StoredSettings> {
    return this.#serial(async () => {
      if (revision !== undefined && revision !== this.#settings.revision) throw conflict();
      const next = { ...this.#settings, values, revision: this.#settings.revision + 1, updatedAt: Date.now() };
      await this.#write(next);
      return next;
    });
  }

  setAdminKeyHash(hash: string, onlyIfMissing: boolean): Promise<boolean> {
    return this.#serial(async () => {
      if (onlyIfMissing && this.#settings.adminKeyHash) return false;
      await this.#write({ ...this.#settings, adminKeyHash: hash });
      return true;
    });
  }

  onExternalChange(listener: (settings: StoredSettings) => void): void {
    this.#listeners.push(listener);
    if (this.#watcher) return;
    // Watch the folder rather than the file: an atomic save replaces the file.
    try {
      this.#watcher = watch(this.#dir, (_event, name) => {
        if (name !== "settings.json") return;
        if (this.#timer) clearTimeout(this.#timer);
        this.#timer = setTimeout(() => void this.#reread(), 150);
      });
      this.#watcher.unref();
    } catch (error) {
      this.#log(`[settings] can't watch ${this.#dir} for edits: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async #reread(): Promise<void> {
    this.#timer = null;
    await this.#writing;
    let text: string;
    try {
      text = await readFile(this.#file, "utf8");
    } catch {
      return;
    }
    if (digest(text) === this.#digest) return;
    try {
      const next = normalize(JSON.parse(text));
      this.#digest = digest(text);
      this.#settings = next;
      for (const listener of this.#listeners) listener(next);
    } catch {
      this.#log(`[settings] ${this.#file} isn't valid JSON; keeping the settings in use`);
    }
  }

  async close(): Promise<void> {
    this.#watcher?.close();
    this.#watcher = null;
    if (this.#timer) clearTimeout(this.#timer);
    await this.#writing;
  }
}

const digest = (text: string) => createHash("sha256").update(text).digest("hex");

const CHANNEL = "common_ground_settings";

/** One row in Postgres; instances hear each other's saves through LISTEN/NOTIFY. */
export class PostgresSettingsStore implements SettingsStore {
  readonly kind = "postgres" as const;
  readonly #pool: pg.Pool;
  readonly #log: (message: string) => void;
  #settings: StoredSettings = EMPTY;
  #listener: pg.PoolClient | null = null;
  #closed = false;
  readonly #listeners: ((settings: StoredSettings) => void)[] = [];

  private constructor(pool: pg.Pool, log: (message: string) => void) {
    this.#pool = pool;
    this.#log = log;
  }

  static async open(pool: pg.Pool, log: (message: string) => void = () => {}): Promise<PostgresSettingsStore> {
    await pool.query(`CREATE TABLE IF NOT EXISTS common_ground_settings (
      id smallint PRIMARY KEY,
      revision integer NOT NULL,
      updated_at timestamptz,
      data jsonb NOT NULL
    )`);
    await pool.query(`INSERT INTO common_ground_settings (id, revision, data) VALUES (1, 0, '{"values": {}}') ON CONFLICT (id) DO NOTHING`);
    const store = new PostgresSettingsStore(pool, log);
    await store.#reload();
    return store;
  }

  async #reload(): Promise<boolean> {
    const { rows } = await this.#pool.query<{ revision: number; updated_at: Date | null; data: { values?: Record<string, string>; adminKeyHash?: string } }>(
      "SELECT revision, updated_at, data FROM common_ground_settings WHERE id = 1",
    );
    const row = rows[0];
    if (!row) return false;
    const next = normalize({ ...row.data, revision: row.revision, updatedAt: row.updated_at?.getTime() ?? null });
    const changed = next.revision !== this.#settings.revision || next.adminKeyHash !== this.#settings.adminKeyHash;
    this.#settings = next;
    return changed;
  }

  current(): StoredSettings {
    return this.#settings;
  }

  async save(values: Record<string, string>, revision?: number): Promise<StoredSettings> {
    const { rows } = await this.#pool.query<{ revision: number; updated_at: Date }>(
      `UPDATE common_ground_settings SET data = jsonb_set(data, '{values}', $1::jsonb), revision = revision + 1, updated_at = now()
       WHERE id = 1 AND ($2::integer IS NULL OR revision = $2) RETURNING revision, updated_at`,
      [JSON.stringify(values), revision ?? null],
    );
    if (!rows[0]) throw conflict();
    this.#settings = { ...this.#settings, values, revision: rows[0].revision, updatedAt: rows[0].updated_at.getTime() };
    await this.#pool.query("SELECT pg_notify($1, $2)", [CHANNEL, String(rows[0].revision)]);
    return this.#settings;
  }

  async setAdminKeyHash(hash: string, onlyIfMissing: boolean): Promise<boolean> {
    const { rowCount } = await this.#pool.query(
      `UPDATE common_ground_settings SET data = jsonb_set(data, '{adminKeyHash}', to_jsonb($1::text)) WHERE id = 1 AND (NOT $2 OR NOT (data ? 'adminKeyHash'))`,
      [hash, onlyIfMissing],
    );
    await this.#reload();
    if (rowCount) await this.#pool.query("SELECT pg_notify($1, $2)", [CHANNEL, "key"]);
    return Boolean(rowCount);
  }

  onExternalChange(listener: (settings: StoredSettings) => void): void {
    this.#listeners.push(listener);
    if (this.#listeners.length === 1) void this.#listen();
  }

  async #listen(): Promise<void> {
    if (this.#closed) return;
    let client: pg.PoolClient | undefined;
    // Released once, whichever comes first: a dropped connection or a failed LISTEN.
    let dead = false;
    const giveUp = (why: string, error?: Error) => {
      // Once the store is closed, close() releases the listener.
      if (dead || this.#closed) return;
      dead = true;
      if (this.#listener === client) this.#listener = null;
      client?.release(error ?? true);
      this.#log(`[settings] ${why}; listening again in 5 s`);
      setTimeout(() => void this.#listen(), 5_000).unref();
    };
    try {
      client = await this.#pool.connect();
      client.on("notification", () => {
        void this.#reload().then(
          (changed) => changed && this.#listeners.forEach((l) => l(this.#settings)),
          (error: unknown) => this.#log(`[settings] reload failed: ${error instanceof Error ? error.message : String(error)}`),
        );
      });
      client.on("error", (error) => giveUp(`lost the Postgres listener (${error.message})`, error));
      await client.query(`LISTEN ${CHANNEL}`);
      this.#listener = client;
      // Catch up on anything saved while we weren't listening.
      if (await this.#reload()) this.#listeners.forEach((l) => l(this.#settings));
    } catch (error) {
      giveUp(`can't listen for settings changes in Postgres (${error instanceof Error ? error.message : String(error)})`, error instanceof Error ? error : undefined);
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    const client = this.#listener;
    this.#listener = null;
    if (client) {
      await client.query(`UNLISTEN ${CHANNEL}`).catch(() => {});
      client.release();
    }
  }
}

interface SqliteSettingsRow {
  revision: number;
  updated_at: number | null;
  setting_values: string;
  admin_key_hash: string | null;
}

/**
 * One row in a SQLite file. SQLite can't announce changes, so other processes' saves (another
 * instance on this machine, the key script) are found by checking the file's data version, which
 * moves only when another connection commits.
 */
export class SqliteSettingsStore implements SettingsStore {
  readonly kind = "sqlite" as const;
  readonly #log: (message: string) => void;
  readonly #pollMs: number;
  readonly #read: StatementSync;
  readonly #save: StatementSync;
  readonly #setKey: StatementSync;
  readonly #dataVersion: StatementSync;
  #settings: StoredSettings = EMPTY;
  /** The values as last read, to tell an outside edit that kept the revision. */
  #valuesText = "{}";
  #version: unknown = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  readonly #listeners: ((settings: StoredSettings) => void)[] = [];

  private constructor(db: DatabaseSync, log: (message: string) => void, pollMs: number) {
    this.#log = log;
    this.#pollMs = pollMs;
    this.#read = db.prepare("SELECT revision, updated_at, setting_values, admin_key_hash FROM common_ground_settings WHERE id = 1");
    this.#save = db.prepare(
      `UPDATE common_ground_settings SET setting_values = ?1, revision = revision + 1, updated_at = ?2
       WHERE id = 1 AND (?3 IS NULL OR revision = ?3) RETURNING revision, updated_at`,
    );
    this.#setKey = db.prepare("UPDATE common_ground_settings SET admin_key_hash = ?1 WHERE id = 1 AND (?2 = 0 OR admin_key_hash IS NULL)");
    this.#dataVersion = db.prepare("PRAGMA data_version");
  }

  /** `pollMs`: how often to look for other processes' changes once something listens. */
  static async open(db: DatabaseSync, log: (message: string) => void = () => {}, pollMs = 1_000): Promise<SqliteSettingsStore> {
    db.exec(`CREATE TABLE IF NOT EXISTS common_ground_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      revision INTEGER NOT NULL,
      updated_at INTEGER,
      setting_values TEXT NOT NULL,
      admin_key_hash TEXT
    )`);
    db.exec("INSERT INTO common_ground_settings (id, revision, setting_values) VALUES (1, 0, '{}') ON CONFLICT (id) DO NOTHING");
    const store = new SqliteSettingsStore(db, log, pollMs);
    store.#reload();
    return store;
  }

  /** Read the row; true if it differs from what we had. */
  #reload(): boolean {
    this.#version = this.#dataVersion.get()?.data_version;
    const row = this.#read.get() as SqliteSettingsRow | undefined;
    if (!row) return false;
    let values: unknown = {};
    try {
      values = JSON.parse(row.setting_values);
    } catch {
      this.#log("[settings] the values saved in SQLite aren't valid JSON; ignoring them");
    }
    const next = normalize({ values, revision: row.revision, updatedAt: row.updated_at, adminKeyHash: row.admin_key_hash ?? undefined });
    const changed = next.revision !== this.#settings.revision || next.adminKeyHash !== this.#settings.adminKeyHash || row.setting_values !== this.#valuesText;
    this.#settings = next;
    this.#valuesText = row.setting_values;
    return changed;
  }

  current(): StoredSettings {
    return this.#settings;
  }

  async save(values: Record<string, string>, revision?: number): Promise<StoredSettings> {
    const text = JSON.stringify(values);
    const row = this.#save.get(text, Date.now(), revision ?? null) as { revision: number; updated_at: number } | undefined;
    if (!row) throw conflict();
    this.#settings = { ...this.#settings, values, revision: row.revision, updatedAt: row.updated_at };
    this.#valuesText = text;
    return this.#settings;
  }

  async setAdminKeyHash(hash: string, onlyIfMissing: boolean): Promise<boolean> {
    const { changes } = this.#setKey.run(hash, onlyIfMissing ? 1 : 0);
    this.#reload();
    return Number(changes) > 0;
  }

  onExternalChange(listener: (settings: StoredSettings) => void): void {
    this.#listeners.push(listener);
    if (this.#timer) return;
    this.#timer = setInterval(() => this.#poll(), this.#pollMs);
    this.#timer.unref();
  }

  #poll(): void {
    try {
      if (this.#dataVersion.get()?.data_version === this.#version) return;
      if (this.#reload()) for (const listener of this.#listeners) listener(this.#settings);
    } catch (error) {
      this.#log(`[settings] can't read the settings from SQLite (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  async close(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }
}
