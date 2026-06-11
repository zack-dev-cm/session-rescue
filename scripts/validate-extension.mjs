#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

assert(manifest.manifest_version === 3, "manifest_version must be 3");
assert(manifest.name === "Session Rescue", "extension name must be Session Rescue");
assert(manifest.action.default_popup === "src/popup.html", "popup path is missing");
assert(manifest.background.service_worker === "src/background.js", "background worker is missing");
assert(manifest.background.type === "module", "background worker must be an ES module");
assert(manifest.version === packageJson.version, "manifest version must match package.json version");

const permissions = new Set(manifest.permissions || []);
for (const permission of ["alarms", "tabs"]) {
  assert(permissions.has(permission), `missing ${permission} permission`);
}
for (const permission of ["storage", "history", "sessions", "downloads", "scripting", "cookies", "management"]) {
  assert(!permissions.has(permission), `avoid ${permission} permission in MVP`);
}
assert(!manifest.host_permissions, "avoid host permissions in MVP");

const sourceText = [
  await readFile(join(root, manifest.action.default_popup), "utf8"),
  await readFile(join(root, manifest.background.service_worker), "utf8"),
  await readFile(join(root, "src/library.html"), "utf8"),
  await readFile(join(root, "src/library.js"), "utf8"),
  await readFile(join(root, "src/popup.js"), "utf8"),
  await readFile(join(root, "src/shared.js"), "utf8"),
  await readFile(join(root, "src/snapshot-store.js"), "utf8"),
].join("\n");

assertUrlGateSelfTest();
for (const url of extractHttpUrls(sourceText)) {
  assert(isAllowedLocalUrl(url), `unexpected remote URL in extension source: ${url}`);
}

console.log("Session Rescue extension manifest is valid.");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function extractHttpUrls(text) {
  return [...text.matchAll(/\bhttps?:\/\/[^\s"'`<>\\)]+/g)].map((match) => match[0]);
}

function isAllowedLocalUrl(value) {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function assertUrlGateSelfTest() {
  for (const url of ["http://localhost:3000/path", "http://127.0.0.1:4173/#ok"]) {
    assert(isAllowedLocalUrl(url), `validator self-test failed for allowed URL: ${url}`);
  }
  for (const url of ["https://localhost.evil.example/pixel", "https://127.0.0.1.evil.example/pixel"]) {
    assert(!isAllowedLocalUrl(url), `validator self-test failed for blocked URL: ${url}`);
  }
}
