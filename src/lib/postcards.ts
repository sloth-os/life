// Postcard illustrations are too large for the save file (localStorage), so they live in
// IndexedDB, keyed by expedition. Everything degrades to "no postcard" where storage is blocked.
const DB_NAME = "common-ground";
const STORE = "postcards";

let opening: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB unavailable"));
  });
  opening.catch(() => (opening = null));
  return opening;
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const request = work(database.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
      }),
  );
}

export interface StoredPostcard {
  blob: Blob;
  paintedAt: number;
}

export async function savePostcard(expeditionId: string, blob: Blob): Promise<void> {
  await run("readwrite", (s) => s.put({ blob, paintedAt: Date.now() } satisfies StoredPostcard, expeditionId)).catch(() => undefined);
}

export async function loadPostcard(expeditionId: string): Promise<StoredPostcard | null> {
  return ((await run("readonly", (s) => s.get(expeditionId)).catch(() => undefined)) as StoredPostcard | undefined) ?? null;
}
