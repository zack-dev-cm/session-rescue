export const DB_NAME = "session-rescue";
export const DB_VERSION = 1;
export const SNAPSHOT_STORE = "snapshots";
export const META_STORE = "meta";
export const MAX_SNAPSHOTS = 60;
export const MAX_IMPORT_BYTES = 2_000_000;
export const AUTO_SNAPSHOT_MINUTES = 10;
export const LOSS_THRESHOLD_TABS = 3;

export function isRestorableUrl(value) {
  if (!value || typeof value !== "string") {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeTab(tab, fallbackIndex = 0) {
  if (!tab || !isRestorableUrl(tab.url)) {
    return null;
  }
  return {
    url: tab.url,
    title: normalizeTitle(tab.title),
    pinned: Boolean(tab.pinned),
    active: Boolean(tab.active),
    index: Number.isInteger(tab.index) ? tab.index : fallbackIndex,
  };
}

export function normalizeWindow(window, fallbackIndex = 0) {
  const tabs = (window.tabs || [])
    .map((tab, index) => normalizeTab(tab, index))
    .filter(Boolean)
    .sort((a, b) => a.index - b.index);

  if (!tabs.length) {
    return null;
  }

  const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.active));
  return {
    index: Number.isInteger(window.index) ? window.index : fallbackIndex,
    focused: Boolean(window.focused),
    activeTabIndex: activeIndex,
    tabs: tabs.map(({ index, ...tab }) => tab),
  };
}

export function buildSnapshot(windows, now = new Date(), reason = "manual") {
  const normalizedWindows = (windows || [])
    .filter((window) => !window.incognito)
    .map((window, index) => normalizeWindow(window, index))
    .filter(Boolean)
    .sort((a, b) => a.index - b.index)
    .map(({ index, ...window }) => window);

  const tabCount = normalizedWindows.reduce((count, window) => count + window.tabs.length, 0);
  const signature = snapshotSignature(normalizedWindows);
  return {
    schemaVersion: 1,
    id: `sr_${Number(now)}_${hashString(`${signature}:${reason}:${Number(now)}`)}`,
    createdAt: now.toISOString(),
    reason,
    tabCount,
    windowCount: normalizedWindows.length,
    title: titleForSnapshot(normalizedWindows, now),
    signature,
    windows: normalizedWindows,
  };
}

export function sanitizeSnapshot(input) {
  if (!input || typeof input !== "object") {
    throw new Error("Snapshot must be an object");
  }
  const createdAt = validDateString(input.createdAt) ? input.createdAt : new Date().toISOString();
  const windows = (input.windows || [])
    .map((window) => sanitizeWindow(window))
    .filter(Boolean);
  const tabCount = windows.reduce((count, window) => count + window.tabs.length, 0);
  if (!tabCount) {
    throw new Error("Snapshot does not contain restorable HTTP or HTTPS tabs");
  }
  const signature = snapshotSignature(windows);
  return {
    schemaVersion: 1,
    id: typeof input.id === "string" && input.id.startsWith("sr_")
      ? input.id
      : `sr_${Date.parse(createdAt)}_${hashString(signature)}`,
    createdAt,
    reason: ["manual", "auto", "risk", "import"].includes(input.reason) ? input.reason : "import",
    tabCount,
    windowCount: windows.length,
    title: normalizeTitle(input.title) || titleForSnapshot(windows, new Date(createdAt)),
    signature,
    windows,
  };
}

export function restorePlan(snapshot) {
  const safeSnapshot = sanitizeSnapshot(snapshot);
  return safeSnapshot.windows
    .map((window) => ({
      urls: window.tabs.map((tab) => tab.url).filter(isRestorableUrl),
      pinnedIndexes: window.tabs
        .map((tab, index) => (tab.pinned ? index : -1))
        .filter((index) => index >= 0),
      activeTabIndex: window.activeTabIndex,
    }))
    .filter((window) => window.urls.length);
}

export function mergeSnapshots(existing, incoming, options = {}) {
  const limit = options.limit || MAX_SNAPSHOTS;
  const allowDuplicate = Boolean(options.allowDuplicate);
  const current = Array.isArray(existing) ? existing.map(sanitizeSnapshot) : [];
  const next = sanitizeSnapshot(incoming);

  if (!allowDuplicate) {
    const duplicateIndex = current.findIndex((snapshot) => snapshot.signature === next.signature);
    if (duplicateIndex >= 0) {
      const duplicate = current[duplicateIndex];
      const updated = {
        ...duplicate,
        createdAt: next.createdAt > duplicate.createdAt ? next.createdAt : duplicate.createdAt,
        reason: next.reason,
      };
      return [updated, ...current.filter((_, index) => index !== duplicateIndex)]
        .sort(sortSnapshots)
        .slice(0, limit);
    }
  }

  return [next, ...current]
    .sort(sortSnapshots)
    .slice(0, limit);
}

export function parseBackup(text) {
  if (typeof text !== "string" || text.length > MAX_IMPORT_BYTES) {
    throw new Error("Backup JSON is missing or too large");
  }
  const data = JSON.parse(text);
  const snapshots = Array.isArray(data.snapshots) ? data.snapshots : Array.isArray(data) ? data : [];
  if (!snapshots.length) {
    throw new Error("Backup JSON does not contain snapshots");
  }
  return snapshots.map((snapshot) => sanitizeSnapshot({ ...snapshot, reason: "import" }));
}

export function buildBackup(snapshots) {
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    source: "Session Rescue",
    snapshots: snapshots.map(sanitizeSnapshot),
  };
}

export function detectRisk(previous, current, now = new Date()) {
  if (!previous || !current || previous.signature === current.signature) {
    return null;
  }
  const lostTabs = previous.tabCount - current.tabCount;
  if (lostTabs < LOSS_THRESHOLD_TABS) {
    return null;
  }
  return {
    snapshotId: previous.id,
    lostTabs,
    detectedAt: now.toISOString(),
    message: `${lostTabs} tabs disappeared from the last saved session.`,
  };
}

export function sortSnapshots(a, b) {
  return Date.parse(b.createdAt) - Date.parse(a.createdAt);
}

function sanitizeWindow(window) {
  const tabs = (window?.tabs || [])
    .map((tab, index) => ({
      url: tab?.url,
      title: normalizeTitle(tab?.title),
      pinned: Boolean(tab?.pinned),
      active: Boolean(tab?.active),
      index,
    }))
    .filter((tab) => isRestorableUrl(tab.url));
  if (!tabs.length) {
    return null;
  }
  const activeTabIndex = Number.isInteger(window.activeTabIndex)
    ? Math.min(Math.max(window.activeTabIndex, 0), tabs.length - 1)
    : Math.max(0, tabs.findIndex((tab) => tab.active));
  return {
    focused: Boolean(window.focused),
    activeTabIndex,
    tabs: tabs.map(({ index, ...tab }) => tab),
  };
}

function snapshotSignature(windows) {
  return windows
    .map((window) => window.tabs.map((tab) => `${tab.pinned ? "1" : "0"}:${tab.url}`).join("|"))
    .join("||");
}

function titleForSnapshot(windows, now) {
  const firstTitle = windows[0]?.tabs[0]?.title || windows[0]?.tabs[0]?.url || "Session";
  const date = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
  return `${firstTitle} (${date})`;
}

function normalizeTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 180);
}

function validDateString(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
