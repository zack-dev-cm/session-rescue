const summary = document.querySelector("#summary");
const sessionsNode = document.querySelector("#sessions");
const searchInput = document.querySelector("#search");
const snapshotButton = document.querySelector("#snapshot");
const exportButton = document.querySelector("#export");
const importInput = document.querySelector("#import");
const clearButton = document.querySelector("#clear");
let sessions = [];

snapshotButton.addEventListener("click", async () => {
  await sendMessage({ type: "capture" });
  await load();
});

exportButton.addEventListener("click", async () => {
  const response = await sendMessage({ type: "export" });
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
  const text = await file.text();
  const response = await sendMessage({ type: "import", text });
  importInput.value = "";
  if (!response.ok) {
    setSummary(response.error);
    return;
  }
  setSummary(`Imported ${response.imported} snapshots.`);
  await load();
});

clearButton.addEventListener("click", async () => {
  await sendMessage({ type: "clear" });
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
  sessionsNode.replaceChildren(...visible.map(renderSession));
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
  restore.textContent = "Restore";
  restore.addEventListener("click", async () => {
    const response = await sendMessage({ type: "restore", id: session.id });
    setSummary(response.ok ? `Restored ${response.restoredTabs} tabs.` : response.error);
  });
  const remove = document.createElement("button");
  remove.textContent = "Delete";
  remove.addEventListener("click", async () => {
    await sendMessage({ type: "delete", id: session.id });
    await load();
  });
  actions.replaceChildren(restore, remove);
  item.replaceChildren(heading, meta, list, actions);
  return item;
}

function sessionText(session) {
  return [
    session.title,
    ...session.windows.flatMap((window) => window.tabs.flatMap((tab) => [tab.title, tab.url])),
  ].join(" ").toLowerCase();
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
  return chrome.runtime.sendMessage(message);
}

load();
