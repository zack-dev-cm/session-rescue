#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import net from "node:net";

const root = new URL("..", import.meta.url).pathname;
const distDir = join(root, "dist");
const extensionDir = join(distDir, "extension");
const cwsAssetsDir = join(root, "docs/cws/assets");
let chrome;

main();

async function main() {
  try {
    await mkdir(cwsAssetsDir, { recursive: true });
    const debugPort = await freePort();
    const profileDir = join(distDir, "cws-capture", `chrome-profile-${Date.now()}`);
    chrome = await launchChrome(findChrome(), debugPort, profileDir);
    const extensionId = await waitForExtensionId(debugPort);

    const library = await createPage(debugPort, `chrome-extension://${extensionId}/src/library.html`);
    await library.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await seedSnapshots(library);
    await library.waitFor("document.body.innerText.includes('3 local snapshots')", 10_000, "seeded library state");
    await writeFile(
      join(cwsAssetsDir, "screenshot-library-1280x800.png"),
      Buffer.from(await capturePng(library), "base64"),
    );

    await library.evaluate(`
      const input = document.querySelector('#search');
      input.value = 'research';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    `);
    await library.waitFor("document.body.innerText.includes('Research recovery sprint')", 10_000, "search result");
    await writeFile(
      join(cwsAssetsDir, "screenshot-search-1280x800.png"),
      Buffer.from(await capturePng(library), "base64"),
    );

    const popup = await createPage(debugPort, `chrome-extension://${extensionId}/src/popup.html`);
    await popup.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await popup.evaluate(`
      document.documentElement.classList.add('cws-capture');
      document.body.classList.add('cws-capture');
    `);
    await popup.waitFor("document.body.innerText.includes('Snapshot now')", 10_000, "popup ready");
    await writeFile(
      join(cwsAssetsDir, "screenshot-popup-1280x800.png"),
      Buffer.from(await capturePng(popup), "base64"),
    );

    console.log("Captured real Session Rescue CWS screenshots");
  } finally {
    chrome?.kill("SIGTERM");
  }
}

async function seedSnapshots(page) {
  const backup = {
    schemaVersion: 1,
    exportedAt: "2026-04-23T08:00:00.000Z",
    source: "Session Rescue",
    snapshots: [
      snapshot("sr_1776902400000_research", "Research recovery sprint", "manual", "2026-04-23T08:00:00.000Z", [
        ["Project brief", "https://example.com/project-brief", true],
        ["Design references", "https://example.com/design-references", false],
        ["Release checklist", "https://example.com/release-checklist", false],
        ["QA notes", "https://example.com/qa-notes", false],
        ["Support queue", "https://example.com/support", false],
      ]),
      snapshot("sr_1776816000000_backup", "Release backup workspace", "manual", "2026-04-22T08:00:00.000Z", [
        ["Chrome review steps", "https://example.com/reviewer-steps", true],
        ["Privacy policy", "https://example.com/privacy", false],
        ["Portable JSON backup", "https://example.com/backup-json", false],
      ]),
      snapshot("sr_1776729600000_restore", "Restored planning window", "import", "2026-04-21T08:00:00.000Z", [
        ["Roadmap", "https://example.com/roadmap", true],
        ["Sprint board", "https://example.com/sprint-board", false],
        ["Research notes", "https://example.com/research-notes", false],
        ["Demo script", "https://example.com/demo-script", false],
      ]),
    ],
  };
  await page.evaluate(`
    chrome.runtime.sendMessage({ type: "clear" }).then(() => chrome.runtime.sendMessage({
      type: "import",
      text: ${JSON.stringify(JSON.stringify(backup))}
    })).then(() => location.reload());
  `);
}

function snapshot(id, title, reason, createdAt, tabs) {
  return {
    schemaVersion: 1,
    id,
    title,
    reason,
    createdAt,
    windows: [
      {
        focused: true,
        activeTabIndex: 0,
        tabs: tabs.map(([tabTitle, url, active], index) => ({
          title: tabTitle,
          url,
          active: Boolean(active),
          pinned: index === 0,
        })),
      },
    ],
  };
}

async function capturePng(page) {
  const response = await page.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
    fromSurface: true,
  });
  return response.result.data;
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Users/zack/Library/Caches/ms-playwright/chromium-1200/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error("Chrome executable not found. Set CHROME_PATH.");
  }
  return found;
}

async function launchChrome(chromePath, debugPort, profileDir) {
  await rm(profileDir, { recursive: true, force: true });
  await mkdir(profileDir, { recursive: true });
  const args = [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-features=Translate,MediaRouter",
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    "about:blank",
  ];
  const child = spawn(chromePath, args, { stdio: ["ignore", "ignore", "pipe"] });
  await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`).catch(() => null);
    return response?.ok;
  }, 15_000, "Chrome remote debugging");
  return child;
}

async function waitForExtensionId(debugPort) {
  let target;
  await waitFor(async () => {
    target = (await listTargets(debugPort)).find((item) =>
      item.type === "service_worker" && item.url.includes("/src/background.js"));
    return Boolean(target);
  }, 15_000, "extension service worker");
  return target.url.match(/^chrome-extension:\/\/([^/]+)/)?.[1];
}

async function createPage(debugPort, url) {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  if (!response.ok) {
    throw new Error(`Failed to create page for ${url}: HTTP ${response.status}`);
  }
  const target = await response.json();
  const page = new CdpPage(target.webSocketDebuggerUrl);
  await page.open();
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  await page.waitFor("document.readyState !== 'loading'", 10_000, `load for ${url}`).catch(() => {});
  return page;
}

async function listTargets(debugPort) {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
  if (!response.ok) {
    throw new Error(`Failed to list Chrome targets: HTTP ${response.status}`);
  }
  return response.json();
}

class CdpPage {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
  }

  async open() {
    this.socket = new WebSocket(this.wsUrl);
    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      const handler = this.pending.get(message.id);
      if (handler) {
        this.pending.delete(message.id);
        handler(message);
      }
    };
    await new Promise((resolve, reject) => {
      this.socket.onopen = resolve;
      this.socket.onerror = reject;
    });
  }

  send(method, params = {}, timeoutMs = 10_000) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, (message) => {
        clearTimeout(timeout);
        resolve(message);
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, returnByValue = false) {
    const response = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue,
    });
    if (response.result?.exceptionDetails) {
      const details = response.result.exceptionDetails;
      const description = details.exception?.description || details.exception?.value || details.text;
      throw new Error(description || "Runtime.evaluate failed");
    }
    return returnByValue ? response.result?.result?.value : response.result?.result;
  }

  async waitFor(expression, timeoutMs = 10_000, label = "browser condition") {
    await waitFor(async () => {
      const value = await this.evaluate(expression, true).catch(() => false);
      return Boolean(value);
    }, timeoutMs, label);
  }
}

async function waitFor(fn, timeoutMs, label = "condition") {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}
