const summary = document.querySelector("#summary");
const sessionsNode = document.querySelector("#sessions");
const searchInput = document.querySelector("#search");
const snapshotButton = document.querySelector("#snapshot");
const exportButton = document.querySelector("#export");
const importInput = document.querySelector("#import");
const clearButton = document.querySelector("#clear");
let sessions = [];

snapshotButton.addEventListener("click", async () => {
  snapshotButton.disabled = true;
  snapshotButton.classList.add("is-busy");
  setSummary("Saving snapshot...");
  try {
    const response = await sendMessage({ type: "capture" });
    if (!response.ok) {
      setSummary(response.error);
      return;
    }
    setSummary(`Saved ${response.snapshot.tabCount} tabs.`);
    await load();
  } finally {
    snapshotButton.disabled = false;
    snapshotButton.classList.remove("is-busy");
  }
});

exportButton.addEventListener("click", async () => {
  exportButton.disabled = true;
  const response = await sendMessage({ type: "export" });
  exportButton.disabled = false;
  if (!response.ok) {
    setSummary(response.error);
    return;
  }
  downloadBackup(response.backup);
});

importInput.addEventListener("change", async () => {
  const file = importInput.files?.[0];
  if (!file) {
    return;
  }
  try {
    const text = await file.text();
    const response = await sendMessage({ type: "import", text });
    importInput.value = "";
    if (!response.ok) {
      setSummary(response.error);
      return;
    }
    setSummary(`Imported ${response.imported} snapshots.`);
    await load();
  } catch (error) {
    importInput.value = "";
    setSummary(error?.message || "Could not read that backup file.");
  }
});

clearButton.addEventListener("click", async () => {
  if (!confirm("Delete every local Session Rescue snapshot on this device?")) {
    return;
  }
  clearButton.disabled = true;
  const response = await sendMessage({ type: "clear" });
  clearButton.disabled = false;
  if (!response.ok) {
    setSummary(response.error);
    return;
  }
  setSummary("All local snapshots deleted.");
  await load();
});

searchInput.addEventListener("input", render);

async function load() {
  const response = await sendMessage({ type: "list" });
  if (!response.ok) {
    setSummary(response.error);
    return;
  }
  sessions = response.snapshots || [];
  render();
}

function render() {
  const query = searchInput.value.trim().toLowerCase();
  const visible = sessions.filter((session) => !query || sessionText(session).includes(query));
  setSummary(`${sessions.length} local snapshots, ${visible.length} shown.`);
  const children = visible.length
    ? visible.map(renderSession)
    : [renderEmptyState(sessions.length ? "No snapshots match this search." : "No local snapshots yet. Use Snapshot now to save your current Chrome tabs.")];
  sessionsNode.replaceChildren(...children);
}

function renderSession(session) {
  const item = document.createElement("article");
  item.className = "session-card";
  const heading = document.createElement("h2");
  heading.textContent = session.title;
  const meta = document.createElement("p");
  meta.textContent = `${session.tabCount} tabs, ${session.windowCount} windows, ${new Date(session.createdAt).toLocaleString()}`;

  const list = document.createElement("ol");
  for (const tab of session.windows.flatMap((window) => window.tabs).slice(0, 8)) {
    const row = document.createElement("li");
    row.textContent = tab.title || tab.url;
    list.append(row);
  }

  const actions = document.createElement("div");
  actions.className = "card-actions";
  const restore = document.createElement("button");
  restore.textContent = "Restore new window";
  restore.className = "primary";
  restore.title = "Open and focus a restored Chrome window";
  restore.addEventListener("click", () => restoreSession(session.id, restore, "newWindow"));
  const restoreHere = document.createElement("button");
  restoreHere.textContent = "Restore here";
  restoreHere.title = "Add saved tabs to the current Chrome window";
  restoreHere.addEventListener("click", () => restoreSession(session.id, restoreHere, "currentWindow"));
  const remove = document.createElement("button");
  remove.textContent = "Delete";
  remove.addEventListener("click", async () => {
    await sendMessage({ type: "delete", id: session.id });
    await load();
  });
  actions.replaceChildren(restore, restoreHere, remove);
  item.replaceChildren(heading, meta, list, actions);
  return item;
}

async function restoreSession(id, button, target) {
  const originalText = button.textContent;
  const targetLabel = target === "currentWindow" ? "current window" : "new window";
  button.disabled = true;
  button.classList.add("is-busy");
  button.setAttribute("aria-busy", "true");
  button.textContent = target === "currentWindow" ? "Adding..." : "Restoring...";
  setSummary(target === "currentWindow"
    ? "Adding restored tabs to the current Chrome window..."
    : "Opening restored tabs in a focused Chrome window...");
  try {
    const response = await sendMessage({ type: "restore", id, target });
    if (!response.ok) {
      setSummary(response.error);
      return;
    }
    const windowWord = response.restoredWindows === 1 ? "window" : "windows";
    setSummary(`Restored ${response.restoredTabs} tabs in ${response.restoredWindows} ${windowWord} (${targetLabel}).`);
  } finally {
    button.disabled = false;
    button.classList.remove("is-busy");
    button.removeAttribute("aria-busy");
    button.textContent = originalText;
  }
}

function sessionText(session) {
  return [
    session.title,
    ...session.windows.flatMap((window) => window.tabs.flatMap((tab) => [tab.title, tab.url])),
  ].join(" ").toLowerCase();
}

function renderEmptyState(message) {
  const item = document.createElement("div");
  item.className = "empty-state";
  item.textContent = message;
  return item;
}

function downloadBackup(backup) {
  const blob = new Blob([`${JSON.stringify(backup, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `session-rescue-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function setSummary(message) {
  summary.textContent = message;
}

function sendMessage(message) {
  return chrome.runtime.sendMessage(message).catch((error) => ({
    ok: false,
    error: error?.message || "Session Rescue is restarting. Try again in a moment.",
  }));
}

load();
