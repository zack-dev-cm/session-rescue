#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import net from "node:net";

const root = new URL("..", import.meta.url).pathname;
const distDir = join(root, "dist");
const extensionDir = join(distDir, "extension");
const reportPath = join(distDir, "e2e-report.json");
const markdownPath = join(distDir, "e2e-report.md");
const assertions = [];
let chrome;
let server;

main();

async function main() {
  try {
    const debugPort = await freePort();
    const fixturePort = await freePort();
    const fixtureBase = `http://127.0.0.1:${fixturePort}`;
    server = await startFixtureServer(fixturePort);

    const chromePath = findChrome();
    const profileDir = join(distDir, "e2e", `chrome-profile-${Date.now()}`);
    await mkdir(profileDir, { recursive: true });
    chrome = await launchChrome(chromePath, debugPort, profileDir);

    const extensionId = await waitForExtensionId(debugPort);
    assert(Boolean(extensionId), "loaded unpacked extension and found MV3 service worker");

    const driver = await createPage(debugPort, `chrome-extension://${extensionId}/src/library.html`);
    await driver.evaluate(`Promise.all([
      chrome.tabs.create({ url: ${JSON.stringify(`${fixtureBase}/alpha`)} }),
      chrome.tabs.create({ url: ${JSON.stringify(`${fixtureBase}/beta`)} })
    ])`, true);
    await waitFor(async () => {
      const targets = await listTargets(debugPort);
      return targets.some((target) => target.url.startsWith(`${fixtureBase}/alpha`))
        && targets.some((target) => target.url.startsWith(`${fixtureBase}/beta`));
    }, 10_000, "reviewer fixture tabs");
    assert(true, "opened reviewer-style fixture tabs");

    const popup = await createPage(debugPort, `chrome-extension://${extensionId}/src/popup.html`);
    await popup.waitFor("Boolean(document.querySelector('#snapshot'))", 10_000, "popup snapshot button");
    await popup.send("Page.bringToFront");
    await popup.evaluate(`
      document.querySelector('#snapshot').dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window
      }));
    `);
    try {
      await popup.waitFor("document.body.innerText.includes('snapshots saved locally') || document.body.innerText.includes('Saved')", 10_000, "popup saved status");
    } catch (error) {
      const current = await popup.evaluate("document.body.innerText", true).catch(() => "");
      throw new Error(`${error.message}; popup text: ${String(current).slice(0, 300)}`);
    }
    const popupText = await popup.evaluate("document.body.innerText", true);
    assert(/snapshots saved locally|Saved \d+ tabs/.test(popupText), "created a manual snapshot through the extension UI");

    const library = await createPage(debugPort, `chrome-extension://${extensionId}/src/library.html`);
    await library.waitFor("Boolean(document.querySelector('#search'))", 10_000, "library search field");
    await library.waitFor("document.body.innerText.includes('local snapshots')", 10_000, "library loaded snapshots");
    await library.evaluate(`
      const input = document.querySelector('#search');
      input.value = 'alpha';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    `);
    const libraryText = await library.evaluate("document.body.innerText", true);
    assert(libraryText.includes("/alpha") || libraryText.includes("Alpha Fixture"), "library search matches a saved tab");

    const backup = await library.evaluate("chrome.runtime.sendMessage({ type: 'export' })", true);
    assert(backup?.ok && backup.backup?.snapshots?.length >= 1, "export produces a JSON backup");

    const snapshotId = backup.backup.snapshots[0].id;
    const deleted = await library.evaluate(`chrome.runtime.sendMessage({ type: "delete", id: ${JSON.stringify(snapshotId)} })`, true);
    assert(deleted?.ok && deleted.snapshots.length === 0, "delete removes a saved snapshot");

    const imported = await library.evaluate(`chrome.runtime.sendMessage({
      type: "import",
      text: ${JSON.stringify(JSON.stringify(backup.backup))}
    })`, true);
    assert(imported?.ok && imported.imported >= 1, "import restores a JSON backup");

    const beforeRestore = await listTargets(debugPort);
    await library.evaluate(`chrome.runtime.sendMessage({ type: "restore", id: ${JSON.stringify(snapshotId)} })`);
    await waitFor(async () => (await listTargets(debugPort)).length > beforeRestore.length, 10_000);
    assert(true, "restore opens saved tabs without replacing the current window");

    const report = {
      generatedAt: new Date().toISOString(),
      chromePath,
      ok: assertions.every((item) => item.ok),
      extensionId,
      fixtureBase,
      stagedExtensionDir: extensionDir,
      assertions,
    };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(markdownPath, renderMarkdown(report));
    if (!report.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    assertions.push({ ok: false, message: error.message || String(error) });
    await mkdir(distDir, { recursive: true });
    await writeFile(reportPath, `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      ok: false,
      assertions,
    }, null, 2)}\n`);
    await writeFile(markdownPath, renderMarkdown({ ok: false, assertions }));
    console.error(error.message || error);
    process.exitCode = 1;
  } finally {
    server?.close();
    chrome?.kill("SIGTERM");
  }
}

function assert(condition, message) {
  assertions.push({ ok: Boolean(condition), message });
  if (!condition) {
    throw new Error(message);
  }
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
  }, 15_000);
  return child;
}

async function waitForExtensionId(debugPort) {
  let target;
  await waitFor(async () => {
    target = (await listTargets(debugPort)).find((item) =>
      item.type === "service_worker" && item.url.includes("/src/background.js"));
    return Boolean(target);
  }, 15_000);
  return target.url.match(/^chrome-extension:\/\/([^/]+)/)?.[1];
}

async function createPage(debugPort, url) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const target = await response.json();
      const page = new CdpPage(target.webSocketDebuggerUrl);
      await page.open();
      await page.send("Runtime.enable");
      await page.send("Page.enable");
      await page.waitFor("document.readyState !== 'loading'", 10_000, `load for ${url}`).catch(() => {});
      return page;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Failed to create page for ${url}: ${lastError?.message || lastError}`);
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

async function waitFor(fn, timeoutMs, label = "browser condition") {
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

async function startFixtureServer(port) {
  const app = createServer((request, response) => {
    const title = request.url?.includes("beta") ? "Beta Fixture" : "Alpha Fixture";
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><title>${title}</title><main><h1>${title}</h1><p>Reviewer fixture for Session Rescue.</p></main>`);
  });
  await new Promise((resolve) => app.listen(port, "127.0.0.1", resolve));
  return app;
}

function renderMarkdown(report) {
  const lines = [
    "# Session Rescue E2E Report",
    "",
    `Status: ${report.ok ? "PASS" : "FAIL"}`,
    "",
    ...report.assertions.map((item) => `- ${item.ok ? "PASS" : "FAIL"}: ${item.message}`),
    "",
  ];
  return lines.join("\n");
}
