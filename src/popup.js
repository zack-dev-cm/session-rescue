const status = document.querySelector("#status");
const sessionsNode = document.querySelector("#sessions");
const snapshotButton = document.querySelector("#snapshot");
const autosaveButton = document.querySelector("#autosave");
const libraryButton = document.querySelector("#library");
const riskNode = document.querySelector("#risk");
let autoEnabled = false;

snapshotButton.addEventListener("click", async () => {
  snapshotButton.disabled = true;
  status.textContent = "Saving snapshot...";
  const response = await sendMessage({ type: "capture" });
  snapshotButton.disabled = false;
  if (!response.ok) {
    status.textContent = response.error;
    return;
  }
  status.textContent = `Saved ${response.snapshot.tabCount} tabs.`;
  await render();
});

libraryButton.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("src/library.html") });
});

autosaveButton.addEventListener("click", async () => {
  autosaveButton.disabled = true;
  const response = await sendMessage({ type: autoEnabled ? "disableAutosave" : "enableAutosave" });
  autosaveButton.disabled = false;
  if (!response.ok) {
    status.textContent = response.error;
    return;
  }
  autoEnabled = Boolean(response.autoEnabled);
  await render();
});

async function render() {
  const response = await sendMessage({ type: "list" });
  if (!response.ok) {
    status.textContent = response.error;
    return;
  }

  const sessions = response.snapshots || [];
  autoEnabled = Boolean(response.autoEnabled);
  autosaveButton.textContent = autoEnabled ? "Disable autosave" : "Enable autosave";
  autosaveButton.title = autoEnabled
    ? "Stop automatic local snapshots"
    : "Start automatic local snapshots of open tab URLs and titles";
  status.textContent = sessions.length
    ? `${sessions.length} snapshots saved locally. Autosave is ${autoEnabled ? "on" : "off"}.`
    : `No snapshots saved yet. Autosave is ${autoEnabled ? "on" : "off"}.`;
  renderRisk(response.riskState);
  sessionsNode.replaceChildren(...sessions.slice(0, 4).map(renderSession));
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
  restore.addEventListener("click", async () => {
    await sendMessage({ type: "restore", id: riskState.snapshotId });
    await render();
  });
  const dismiss = document.createElement("button");
  dismiss.textContent = "Dismiss";
  dismiss.addEventListener("click", async () => {
    await sendMessage({ type: "dismissRisk" });
    await render();
  });
  riskNode.replaceChildren(message, restore, dismiss);
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
  restore.addEventListener("click", () => sendMessage({ type: "restore", id: session.id }));
  item.replaceChildren(title, details, restore);
  return item;
}

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

render();
