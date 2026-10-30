// Where values saved on the settings page are kept: a JSON file under DATA_DIR (one instance), or
// Postgres (DATABASE_URL), which several instances share. Both tell the server when the settings
// change behind its back, so it applies them without a restart: an edit to the file, or another
// instance saving (Postgres LISTEN/NOTIFY).
import { createHash } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type pg from "pg";
import { HttpError } from "../util/errors.ts";

export interface StoredSettings {
  revision: number;
  updatedAt: number | null;
  values: Record<string, string>;
  /** The hash of the key the server generated for the settings page (when ADMIN_KEY isn't set). */
  adminKeyHash?: string;
}

export interface SettingsStore {
  readonly kind: "file" | "postgres";
  current(): StoredSettings;
  /** Save new values. With `revision`, refuse (409) if someone else saved since. */
  save(values: Record<string, string>, revision?: number): Promise<StoredSettings>;
  /** Keep a generated key's hash; with `onlyIfMissing`, false if another instance got there first. */
  setAdminKeyHash(hash: string, onlyIfMissing: boolean): Promise<boolean>;
  /** Called when the settings change elsewhere: the file edited, or another instance saving. */
  onExternalChange(listener: (settings: StoredSettings) => void): void;
  close(): Promise<void>;
}

const EMPTY: StoredSettings = { revision: 0, updatedAt: null, values: {} };

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
    try {
      const client = await this.#pool.connect();
      this.#listener = client;
      client.on("notification", () => {
        void this.#reload().then(
          (changed) => changed && this.#listeners.forEach((l) => l(this.#settings)),
          (error: unknown) => this.#log(`[settings] reload failed: ${error instanceof Error ? error.message : String(error)}`),
        );
      });
      client.on("error", (error) => {
        this.#log(`[settings] lost the Postgres listener (${error.message}); reconnecting`);
        this.#listener = null;
        client.release(error);
        setTimeout(() => void this.#listen(), 5_000).unref();
      });
      await client.query(`LISTEN ${CHANNEL}`);
      // Catch up on anything saved while we weren't listening.
      if (await this.#reload()) this.#listeners.forEach((l) => l(this.#settings));
    } catch (error) {
      this.#log(`[settings] can't listen for changes in Postgres (${error instanceof Error ? error.message : String(error)}); retrying`);
      setTimeout(() => void this.#listen(), 5_000).unref();
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
