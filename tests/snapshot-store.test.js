import test from "node:test";
import assert from "node:assert/strict";
import { indexedDB } from "fake-indexeddb";

globalThis.indexedDB = indexedDB;

const store = await import("../src/snapshot-store.js");

test("concurrent snapshot saves keep both sessions", async () => {
  await store.clearSnapshots();

  await Promise.all([
    store.saveSnapshot(snapshot("sr_test_a", "https://example.com/a", "2026-06-11T10:00:00.000Z"), { allowDuplicate: true }),
    store.saveSnapshot(snapshot("sr_test_b", "https://example.com/b", "2026-06-11T10:00:01.000Z"), { allowDuplicate: true }),
  ]);

  const snapshots = await store.getSnapshots();
  const urls = new Set(snapshots.flatMap((item) => item.windows.flatMap((window) => window.tabs.map((tab) => tab.url))));

  assert.equal(snapshots.length, 2);
  assert.equal(urls.has("https://example.com/a"), true);
  assert.equal(urls.has("https://example.com/b"), true);
});

function snapshot(id, url, createdAt) {
  return {
    schemaVersion: 1,
    id,
    createdAt,
    reason: "manual",
    title: `Snapshot ${id}`,
    windows: [{
      focused: true,
      activeTabIndex: 0,
      tabs: [{
        title: `Tab ${id}`,
        url,
        pinned: false,
        active: true,
      }],
    }],
  };
}
