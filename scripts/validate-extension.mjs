#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));

assert(manifest.manifest_version === 3, "manifest_version must be 3");
assert(manifest.name === "Session Rescue", "extension name must be Session Rescue");
assert(manifest.action.default_popup === "src/popup.html", "popup path is missing");
assert(manifest.background.service_worker === "src/background.js", "background worker is missing");
assert(manifest.background.type === "module", "background worker must be an ES module");

const permissions = new Set(manifest.permissions || []);
for (const permission of ["alarms", "tabs"]) {
  assert(permissions.has(permission), `missing ${permission} permission`);
}
for (const permission of ["storage", "history", "sessions", "downloads", "scripting", "cookies", "management"]) {
  assert(!permissions.has(permission), `avoid ${permission} permission in MVP`);
}
assert(!manifest.host_permissions, "avoid host permissions in MVP");

await readFile(join(root, manifest.action.default_popup), "utf8");
await readFile(join(root, manifest.background.service_worker), "utf8");
await readFile(join(root, "src/library.html"), "utf8");

console.log("Session Rescue extension manifest is valid.");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
