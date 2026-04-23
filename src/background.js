import {
  AUTO_SNAPSHOT_MINUTES,
  buildBackup,
  buildSnapshot,
  detectRisk,
  parseBackup,
  restorePlan,
} from "./shared.js";
import {
  clearSnapshots,
  deleteSnapshot,
  getMeta,
  getSnapshots,
  replaceSnapshots,
  saveSnapshot,
  setMeta,
} from "./snapshot-store.js";

const AUTO_ALARM = "session-rescue-auto-snapshot";
const RISK_STATE = "riskState";
let debounceTimer;

chrome.runtime.onInstalled.addListener(() => {
  configureAlarms();
  captureAndStore("install", { allowDuplicate: false }).catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  configureAlarms();
  captureAndStore("startup", { allowDuplicate: false }).catch(console.error);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_ALARM) {
    captureAndStore("auto", { allowDuplicate: false }).catch(console.error);
  }
});

chrome.tabs.onCreated.addListener(() => queueAutoSnapshot());
chrome.tabs.onRemoved.addListener(() => queueAutoSnapshot());
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.title || changeInfo.status === "complete") {
    queueAutoSnapshot();
  }
});
chrome.tabs.onMoved.addListener(() => queueAutoSnapshot());
chrome.tabs.onAttached.addListener(() => queueAutoSnapshot());
chrome.tabs.onDetached.addListener(() => queueAutoSnapshot());

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

async function handleMessage(message = {}) {
  switch (message.type) {
    case "capture":
      return { snapshot: await captureAndStore("manual", { allowDuplicate: true }) };
    case "list":
      return { snapshots: await getSnapshots(), riskState: await getMeta(RISK_STATE) };
    case "restore":
      return restoreSnapshot(message.id);
    case "delete":
      await deleteSnapshot(message.id);
      return { snapshots: await getSnapshots() };
    case "clear":
      await clearSnapshots();
      await setMeta(RISK_STATE, null);
      await updateBadge(null);
      return { snapshots: [] };
    case "export":
      return { backup: buildBackup(await getSnapshots()) };
    case "import": {
      const imported = parseBackup(message.text);
      const merged = imported.reduce((sessions, snapshot) => {
        const exists = sessions.some((session) => session.signature === snapshot.signature);
        return exists ? sessions : [snapshot, ...sessions];
      }, await getSnapshots());
      await replaceSnapshots(merged);
      return { snapshots: await getSnapshots(), imported: imported.length };
    }
    case "dismissRisk":
      await setMeta(RISK_STATE, null);
      await updateBadge(null);
      return { riskState: null };
    default:
      throw new Error("Unknown Session Rescue message");
  }
}

async function captureAndStore(reason, options = {}) {
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  const current = buildSnapshot(windows, new Date(), reason);
  if (!current.tabCount) {
    throw new Error("No restorable HTTP or HTTPS tabs found");
  }

  const previous = (await getSnapshots())[0];
  const riskState = detectRisk(previous, current);
  if (riskState) {
    await setMeta(RISK_STATE, riskState);
    await updateBadge(riskState);
  } else if (reason === "manual") {
    await setMeta(RISK_STATE, null);
    await updateBadge(null);
  }

  return saveSnapshot(current, options);
}

async function restoreSnapshot(id) {
  const snapshots = await getSnapshots();
  const snapshot = snapshots.find((item) => item.id === id);
  if (!snapshot) {
    throw new Error("Snapshot not found");
  }

  let restoredTabs = 0;
  for (const windowPlan of restorePlan(snapshot)) {
    const created = await chrome.windows.create({
      focused: false,
      url: windowPlan.urls,
    });
    restoredTabs += windowPlan.urls.length;
    for (const tabIndex of windowPlan.pinnedIndexes) {
      const tabId = created.tabs?.[tabIndex]?.id;
      if (tabId) {
        await chrome.tabs.update(tabId, { pinned: true });
      }
    }
    const activeTabId = created.tabs?.[windowPlan.activeTabIndex]?.id;
    if (activeTabId) {
      await chrome.tabs.update(activeTabId, { active: true });
    }
  }

  await setMeta(RISK_STATE, null);
  await updateBadge(null);
  return { restoredTabs };
}

function configureAlarms() {
  chrome.alarms.create(AUTO_ALARM, {
    delayInMinutes: 1,
    periodInMinutes: AUTO_SNAPSHOT_MINUTES,
  });
}

function queueAutoSnapshot() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    captureAndStore("auto", { allowDuplicate: false }).catch(console.error);
  }, 1200);
}

async function updateBadge(riskState) {
  if (riskState) {
    await chrome.action.setBadgeText({ text: "!" });
    await chrome.action.setBadgeBackgroundColor({ color: "#C2410C" });
  } else {
    await chrome.action.setBadgeText({ text: "" });
  }
}
