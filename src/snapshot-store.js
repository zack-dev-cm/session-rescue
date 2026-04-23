import {
  DB_NAME,
  DB_VERSION,
  META_STORE,
  SNAPSHOT_STORE,
  MAX_SNAPSHOTS,
  mergeSnapshots,
  sanitizeSnapshot,
  sortSnapshots,
} from "./shared.js";

let dbPromise;

export async function getSnapshots() {
  const db = await openDatabase();
  const snapshots = await requestToPromise(db.transaction(SNAPSHOT_STORE, "readonly").objectStore(SNAPSHOT_STORE).getAll());
  return snapshots.map(sanitizeSnapshot).sort(sortSnapshots);
}

export async function saveSnapshot(snapshot, options = {}) {
  const snapshots = mergeSnapshots(await getSnapshots(), snapshot, options);
  await replaceSnapshots(snapshots);
  return snapshots[0];
}

export async function replaceSnapshots(snapshots) {
  const db = await openDatabase();
  const transaction = db.transaction(SNAPSHOT_STORE, "readwrite");
  const store = transaction.objectStore(SNAPSHOT_STORE);
  await requestToPromise(store.clear());
  for (const snapshot of snapshots.slice(0, MAX_SNAPSHOTS)) {
    await requestToPromise(store.put(sanitizeSnapshot(snapshot)));
  }
  await transactionDone(transaction);
}

export async function deleteSnapshot(id) {
  const db = await openDatabase();
  const transaction = db.transaction(SNAPSHOT_STORE, "readwrite");
  await requestToPromise(transaction.objectStore(SNAPSHOT_STORE).delete(id));
  await transactionDone(transaction);
}

export async function clearSnapshots() {
  const db = await openDatabase();
  const transaction = db.transaction(SNAPSHOT_STORE, "readwrite");
  await requestToPromise(transaction.objectStore(SNAPSHOT_STORE).clear());
  await transactionDone(transaction);
}

export async function getMeta(key, fallback = null) {
  const db = await openDatabase();
  const value = await requestToPromise(db.transaction(META_STORE, "readonly").objectStore(META_STORE).get(key));
  return value?.value ?? fallback;
}

export async function setMeta(key, value) {
  const db = await openDatabase();
  const transaction = db.transaction(META_STORE, "readwrite");
  await requestToPromise(transaction.objectStore(META_STORE).put({ key, value }));
  await transactionDone(transaction);
}

export async function openDatabase() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
          const snapshots = db.createObjectStore(SNAPSHOT_STORE, { keyPath: "id" });
          snapshots.createIndex("createdAt", "createdAt");
          snapshots.createIndex("signature", "signature");
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
