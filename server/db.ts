// DATABASE_URL: keep the settings page's values and classroom mode's classes in a database rather
// than in files under DATA_DIR. Postgres (postgres://…) is shared by every instance that uses it;
// SQLite (sqlite:path/to/file.db) is one file, shared by the server processes on one machine.
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import pg from "pg";

export type Database =
  | { kind: "postgres"; pool: pg.Pool; close(): Promise<void> }
  | { kind: "sqlite"; sqlite: DatabaseSync; file: string; close(): Promise<void> };

export type DatabaseTarget = { kind: "postgres"; url: string } | { kind: "sqlite"; file: string };

/**
 * What DATABASE_URL names. For SQLite, everything after `sqlite:` (and an optional `//`) is the
 * file's path: `sqlite:data/common-ground.db` is relative to the working folder, and
 * `sqlite:///var/lib/common-ground.db` is absolute.
 */
export function parseDatabaseUrl(url: string): DatabaseTarget {
  const value = url.trim();
  if (/^postgres(ql)?:\/\//i.test(value)) return { kind: "postgres", url: value };
  const sqlite = /^sqlite:(?:\/\/)?(.*)$/i.exec(value);
  if (sqlite) {
    const file = sqlite[1]!;
    if (!file || file === ":memory:") throw new Error("DATABASE_URL=sqlite: needs a file to keep things in, such as sqlite:data/common-ground.db");
    return { kind: "sqlite", file };
  }
  // Only the scheme: a mistyped Postgres URL could still hold a password.
  throw new Error(`DATABASE_URL should start with postgres://, postgresql:// or sqlite: (it starts with "${value.split(":")[0]!.slice(0, 20)}")`);
}

export async function openDatabase(url: string, opts: { connections: number; log: (message: string) => void }): Promise<Database> {
  const target = parseDatabaseUrl(url);
  if (target.kind === "postgres") {
    const pool = new pg.Pool({ connectionString: target.url, max: opts.connections });
    pool.on("error", (error) => opts.log(`[db] ${error.message}`));
    return { kind: "postgres", pool, close: () => pool.end() };
  }
  // Node's built-in SQLite, loaded only when it's used: Node still calls it experimental, and says so once.
  const { DatabaseSync } = await import("node:sqlite");
  mkdirSync(dirname(target.file), { recursive: true });
  // The file keeps the keys saved on the settings page, so a new one is readable only by the
  // server's user; SQLite gives its -wal and -shm files the same permissions.
  closeSync(openSync(target.file, "a", 0o600));
  // A busy timeout, so a process waits its turn when another is writing.
  const sqlite = new DatabaseSync(target.file, { timeout: 5_000 });
  sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
  return {
    kind: "sqlite",
    sqlite,
    file: target.file,
    close: async () => {
      if (sqlite.isOpen) sqlite.close();
    },
  };
}
