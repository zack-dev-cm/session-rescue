const status = document.querySelector("#status");
const sessionsNode = document.querySelector("#sessions");
const snapshotButton = document.querySelector("#snapshot");
const autosaveButton = document.querySelector("#autosave");
const libraryButton = document.querySelector("#library");
const riskNode = document.querySelector("#risk");
let autoEnabled = false;
let notice = "";

snapshotButton.addEventListener("click", async () => {
  snapshotButton.disabled = true;
  snapshotButton.classList.add("is-busy");
  setStatus("Saving snapshot...");
  try {
    const response = await sendMessage({ type: "capture" });
    if (!response.ok) {
      setStatus(response.error);
      return;
    }
    setStatus(`Saved ${response.snapshot.tabCount} tabs.`);
    await render();
  } finally {
    snapshotButton.disabled = false;
    snapshotButton.classList.remove("is-busy");
  }
});

libraryButton.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("src/library.html") });
});

autosaveButton.addEventListener("click", async () => {
  autosaveButton.disabled = true;
  autosaveButton.classList.add("is-busy");
  try {
    const response = await sendMessage({ type: autoEnabled ? "disableAutosave" : "enableAutosave" });
    if (!response.ok) {
      setStatus(response.error);
      return;
    }
    autoEnabled = Boolean(response.autoEnabled);
    setStatus(`Autosave is ${autoEnabled ? "on" : "off"}.`);
    await render();
  } finally {
    autosaveButton.disabled = false;
    autosaveButton.classList.remove("is-busy");
  }
});

async function render() {
  const response = await sendMessage({ type: "list" });
  if (!response.ok) {
    setStatus(response.error);
    return;
  }

  const sessions = response.snapshots || [];
  autoEnabled = Boolean(response.autoEnabled);
  autosaveButton.textContent = autoEnabled ? "Disable autosave" : "Enable autosave";
  autosaveButton.title = autoEnabled
    ? "Stop automatic local snapshots"
    : "Start automatic local snapshots of open tab URLs and titles";
  const defaultStatus = sessions.length
    ? `${sessions.length} snapshots saved locally. Autosave is ${autoEnabled ? "on" : "off"}.`
    : `No snapshots saved yet. Autosave is ${autoEnabled ? "on" : "off"}.`;
  status.textContent = notice || defaultStatus;
  renderRisk(response.riskState);
  const children = sessions.length
    ? sessions.slice(0, 4).map(renderSession)
    : [renderEmptyState("Save a snapshot to keep a restorable local copy of your current Chrome tabs.")];
  sessionsNode.replaceChildren(...children);
}

function renderRisk(riskState) {
  if (!riskState) {
    riskNode.classList.add("hidden");
    riskNode.replaceChildren();
    return;
  }
  riskNode.classList.remove("hidden");
  const message = document.createElement("p");
  message.textContent = riskState.message;
  const restore = document.createElement("button");
  restore.textContent = "Restore rescue point";
  restore.className = "primary";
  restore.addEventListener("click", () => restoreSession(riskState.snapshotId, restore, "newWindow"));
  const restoreHere = document.createElement("button");
  restoreHere.textContent = "Restore here";
  restoreHere.title = "Add rescued tabs to the current Chrome window";
  restoreHere.addEventListener("click", () => restoreSession(riskState.snapshotId, restoreHere, "currentWindow"));
  const dismiss = document.createElement("button");
  dismiss.textContent = "Dismiss";
  dismiss.addEventListener("click", async () => {
    await sendMessage({ type: "dismissRisk" });
    setStatus("Rescue point dismissed.");
    await render();
  });
  const actions = document.createElement("div");
  actions.className = "card-actions";
  actions.replaceChildren(restore, restoreHere, dismiss);
  riskNode.replaceChildren(message, actions);
}

function renderSession(session) {
  const item = document.createElement("article");
  item.className = "session-card";
  const title = document.createElement("strong");
  title.textContent = session.title;
  const details = document.createElement("span");
  details.textContent = `${session.tabCount} tabs across ${session.windowCount} windows`;
  const restore = document.createElement("button");
  restore.textContent = "Restore";
  restore.className = "primary";
  restore.title = "Open and focus a restored Chrome window";
  restore.addEventListener("click", () => restoreSession(session.id, restore, "newWindow"));
  const restoreHere = document.createElement("button");
  restoreHere.textContent = "Restore here";
  restoreHere.title = "Add saved tabs to the current Chrome window";
  restoreHere.addEventListener("click", () => restoreSession(session.id, restoreHere, "currentWindow"));
  const actions = document.createElement("div");
  actions.className = "card-actions";
  actions.replaceChildren(restore, restoreHere);
  item.replaceChildren(title, details, actions);
  return item;
}

function renderEmptyState(message) {
  const item = document.createElement("div");
  item.className = "empty-state";
  item.textContent = message;
  return item;
}

async function restoreSession(id, button, target) {
  const originalText = button.textContent;
  const targetLabel = target === "currentWindow" ? "current window" : "new window";
  button.disabled = true;
  button.classList.add("is-busy");
  button.setAttribute("aria-busy", "true");
  button.textContent = target === "currentWindow" ? "Adding..." : "Restoring...";
  setStatus(target === "currentWindow"
    ? "Adding restored tabs to the current Chrome window..."
    : "Opening restored tabs in a focused Chrome window...");
  try {
    const response = await sendMessage({ type: "restore", id, target });
    if (!response.ok) {
      setStatus(response.error);
      return;
    }
    const windowWord = response.restoredWindows === 1 ? "window" : "windows";
    setStatus(`Restored ${response.restoredTabs} tabs in ${response.restoredWindows} ${windowWord} (${targetLabel}).`);
    await render();
  } finally {
    button.disabled = false;
    button.classList.remove("is-busy");
    button.removeAttribute("aria-busy");
    button.textContent = originalText;
  }
}

function setStatus(message) {
  notice = message;
  status.textContent = message;
}

function sendMessage(message) {
  return chrome.runtime.sendMessage(message).catch((error) => ({
    ok: false,
    error: error?.message || "Session Rescue is restarting. Try again in a moment.",
  }));
}

render();
