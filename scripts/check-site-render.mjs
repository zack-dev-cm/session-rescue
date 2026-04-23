#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import net from "node:net";

const root = new URL("..", import.meta.url).pathname;
const siteRoot = join(root, "site");
const outDir = join(root, "dist", "site-check");
const pages = [
  { path: "/", name: "home" },
  { path: "/privacy/", name: "privacy" },
  { path: "/support/", name: "support" },
  { path: "/review/", name: "review" },
];
const viewports = [
  { width: 320, height: 900, name: "mobile-320" },
  { width: 390, height: 900, name: "mobile-390" },
  { width: 768, height: 900, name: "tablet-768" },
  { width: 1440, height: 900, name: "desktop-1440" },
];
const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
]);

let chrome;
let server;

main();

async function main() {
  const failures = [];
  try {
    await mkdir(outDir, { recursive: true });
    const sitePort = await freePort();
    server = await serveSite(sitePort);

    const debugPort = await freePort();
    chrome = await launchChrome(debugPort, join(root, "dist", "site-check-profile"));

    for (const pageInfo of pages) {
      for (const viewport of viewports) {
        const url = `http://127.0.0.1:${sitePort}${pageInfo.path}`;
        const page = await createPage(debugPort, "about:blank");
        await page.send("Emulation.setDeviceMetricsOverride", {
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: 1,
          mobile: viewport.width < 768,
        });
        await page.send("Page.navigate", { url }, 45_000);
        await page.waitFor("document.readyState === 'complete'", 15_000, "page load");
        await page.waitFor("[...document.images].every((img) => img.complete && img.naturalWidth > 0)", 15_000, "images loaded");

        const result = await page.evaluate(renderAssertions(), true);
        if (result.horizontalOverflow) {
          failures.push(`${pageInfo.name}/${viewport.name}: horizontal overflow ${result.scrollWidth}>${result.innerWidth}`);
        }
        if (result.overflow.length) {
          failures.push(`${pageInfo.name}/${viewport.name}: element overflow ${JSON.stringify(result.overflow.slice(0, 3))}`);
        }
        if (result.broken.length) {
          failures.push(`${pageInfo.name}/${viewport.name}: broken images ${result.broken.join(", ")}`);
        }
        if (!result.hasFocusCss) {
          failures.push(`${pageInfo.name}/${viewport.name}: missing focus-visible CSS`);
        }
        if (pageInfo.name === "home" && typeof result.nextTop === "number" && result.nextTop > viewport.height - 24) {
          failures.push(`${pageInfo.name}/${viewport.name}: next section not visible, top=${result.nextTop}, viewport=${viewport.height}`);
        }

        const screenshot = await page.send("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: false,
          fromSurface: true,
        }, 45_000);
        await writeFile(
          join(outDir, `${pageInfo.name}-${viewport.name}.png`),
          Buffer.from(screenshot.result.data, "base64"),
        );
      }
    }

    if (failures.length) {
      console.error(failures.map((failure) => `- ${failure}`).join("\n"));
      process.exit(1);
    }
    console.log(`Public page render check passed; screenshots in ${outDir}`);
  } finally {
    server?.close();
    chrome?.kill("SIGTERM");
  }
}

function renderAssertions() {
  return `(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const overflow = [];
    for (const element of document.body.querySelectorAll("*")) {
      if (!visible(element)) continue;
      const style = getComputedStyle(element);
      if (style.display === "inline") continue;
      if (element.scrollWidth > element.clientWidth + 2) {
        overflow.push({
          tag: element.tagName,
          cls: String(element.className),
          text: (element.textContent || "").trim().slice(0, 80),
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
        });
      }
    }
    const broken = [...document.images]
      .filter((img) => !img.complete || img.naturalWidth === 0)
      .map((img) => img.src);
    const documentElement = document.documentElement;
    const nextSection = document.querySelector(".trust-strip, .page, .product-band");
    const nextTop = nextSection ? Math.round(nextSection.getBoundingClientRect().top) : null;
    return {
      scrollWidth: documentElement.scrollWidth,
      innerWidth,
      horizontalOverflow: documentElement.scrollWidth > innerWidth + 1,
      overflow,
      broken,
      nextTop,
      hasFocusCss: [...document.styleSheets].some((sheet) => {
        try {
          return [...sheet.cssRules].some((rule) => String(rule.cssText).includes(":focus-visible"));
        } catch {
          return false;
        }
      }),
    };
  })()`;
}

async function serveSite(port) {
  const siteServer = createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://127.0.0.1:${port}`);
    let filePath = join(siteRoot, decodeURIComponent(url.pathname));
    if (url.pathname.endsWith("/")) {
      filePath = join(filePath, "index.html");
    }
    try {
      const body = await readFile(filePath);
      response.writeHead(200, { "Content-Type": mimeTypes.get(extname(filePath)) || "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("Not found");
    }
  });
  await new Promise((resolve) => siteServer.listen(port, "127.0.0.1", resolve));
  return siteServer;
}

async function launchChrome(debugPort, profileDir) {
  await rm(profileDir, { recursive: true, force: true });
  await mkdir(profileDir, { recursive: true });
  const child = spawn(findChrome(), [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-background-networking",
    "--disable-component-update",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`).catch(() => null);
    return response?.ok;
  }, 15_000, "Chrome remote debugging");
  return child;
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
  await page.waitFor("document.readyState !== 'loading'", 10_000, "initial load").catch(() => {});
  return page;
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
    const portServer = net.createServer();
    portServer.listen(0, "127.0.0.1", () => {
      const { port } = portServer.address();
      portServer.close(() => resolve(port));
    });
    portServer.on("error", reject);
  });
}
