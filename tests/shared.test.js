import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBackup,
  buildSnapshot,
  detectRisk,
  isRestorableUrl,
  mergeSnapshots,
  parseBackup,
  restorePlan,
  sanitizeSnapshot,
} from "../src/shared.js";

test("isRestorableUrl accepts only normal web URLs", () => {
  assert.equal(isRestorableUrl("https://example.com/a"), true);
  assert.equal(isRestorableUrl("http://example.com/a"), true);
  assert.equal(isRestorableUrl("chrome://extensions"), false);
  assert.equal(isRestorableUrl("https://chromewebstore.google.com/detail/example"), false);
  assert.equal(isRestorableUrl("javascript:alert(1)"), false);
  assert.equal(isRestorableUrl("data:text/html,hi"), false);
});

test("buildSnapshot captures normal restorable tabs without page content", () => {
  const snapshot = buildSnapshot([
    {
      focused: true,
      incognito: false,
      tabs: [
        { url: "https://example.com/a", title: "Alpha", pinned: true, active: true, index: 0 },
        { pendingUrl: "https://example.com/pending", title: "Pending", index: 1 },
        { url: "chrome://settings", title: "Settings", index: 1 },
        { url: "https://example.com/b", title: "Beta", index: 2 },
      ],
    },
  ], new Date("2026-04-23T00:00:00Z"), "manual");

  assert.equal(snapshot.tabCount, 3);
  assert.equal(snapshot.windowCount, 1);
  assert.equal(snapshot.windows[0].tabs[0].pinned, true);
  assert.equal(snapshot.windows[0].tabs[0].url, "https://example.com/a");
  assert.equal("content" in snapshot.windows[0].tabs[0], false);
});

test("mergeSnapshots deduplicates automatic snapshots by signature", () => {
  const first = buildSnapshot([{ tabs: [{ url: "https://a.test", title: "A" }] }], new Date("2026-04-23T00:00:00Z"), "auto");
  const second = buildSnapshot([{ tabs: [{ url: "https://a.test", title: "A" }] }], new Date("2026-04-23T01:00:00Z"), "auto");
  const merged = mergeSnapshots([first], second);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].createdAt, second.createdAt);
});

test("restorePlan preserves windows, order, pinned indexes, and active tab", () => {
  const snapshot = sanitizeSnapshot({
    createdAt: "2026-04-23T00:00:00Z",
    windows: [{
      activeTabIndex: 1,
      tabs: [
        { url: "https://a.test", title: "A", pinned: true },
        { url: "https://b.test", title: "B" },
      ],
    }],
  });
  assert.deepEqual(restorePlan(snapshot), [{
    urls: ["https://a.test", "https://b.test"],
    pinnedIndexes: [0],
    activeTabIndex: 1,
  }]);
});

test("parseBackup rejects non-restorable imported URLs", () => {
  assert.throws(() => parseBackup(JSON.stringify({
    snapshots: [{
      createdAt: "2026-04-23T00:00:00Z",
      windows: [{ tabs: [{ url: "javascript:alert(1)", title: "<img>" }] }],
    }],
  })), /restorable/);
});

test("parseBackup rejects oversized tab bursts", () => {
  assert.throws(() => parseBackup(JSON.stringify({
    snapshots: [{
      createdAt: "2026-04-23T00:00:00Z",
      windows: [{
        tabs: Array.from({ length: 201 }, (_, index) => ({
          url: `https://example.com/${index}`,
          title: `Tab ${index}`,
        })),
      }],
    }],
  })), /tab safety limit/);
});

test("exported backups round-trip valid snapshots", () => {
  const snapshot = buildSnapshot([{ tabs: [{ url: "https://round.test", title: "Round" }] }]);
  const backup = buildBackup([snapshot]);
  const parsed = parseBackup(JSON.stringify(backup));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].windows[0].tabs[0].url, "https://round.test");
});

test("detectRisk marks large tab-count loss", () => {
  const previous = buildSnapshot([{ tabs: [
    { url: "https://a.test" },
    { url: "https://b.test" },
    { url: "https://c.test" },
    { url: "https://d.test" },
  ] }]);
  const current = buildSnapshot([{ tabs: [{ url: "https://a.test" }] }]);
  const risk = detectRisk(previous, current, new Date("2026-04-23T00:00:00Z"));
  assert.equal(risk.snapshotId, previous.id);
  assert.equal(risk.lostTabs, 3);
});
