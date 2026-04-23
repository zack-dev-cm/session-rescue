#!/usr/bin/env node

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(repoRoot, "dist");
const extensionDir = join(distDir, "extension");
const manifest = JSON.parse(await readFile(join(repoRoot, "manifest.json"), "utf8"));
const listing = JSON.parse(await readFile(join(repoRoot, "docs/cws/listing.json"), "utf8"));
const zipName = `session-rescue-${manifest.version}.zip`;
const zipPath = join(distDir, zipName);

await mkdir(distDir, { recursive: true });
await rm(extensionDir, { recursive: true, force: true });
await rm(zipPath, { force: true });
await mkdir(extensionDir, { recursive: true });

await cp(join(repoRoot, "manifest.json"), join(extensionDir, "manifest.json"));
await cp(join(repoRoot, "src"), join(extensionDir, "src"), { recursive: true });
await cp(join(repoRoot, "assets"), join(extensionDir, "assets"), { recursive: true });

const zip = spawnSync("zip", ["-qr", zipPath, "."], {
  cwd: extensionDir,
  encoding: "utf8",
});
if (zip.status !== 0) {
  throw new Error(zip.stderr || zip.stdout || `zip exited ${zip.status}`);
}

await writeFile(join(distDir, "launch-manifest.json"), `${JSON.stringify({
  repo_owner: "zack-dev-cm",
  repo_name: "session-rescue",
  repo_url: listing.source_url,
  github_description: "Local-first Chrome extension for saving browser session snapshots, restoring tabs, and exporting portable backups.",
  github_homepage: listing.homepage_url,
  official_url: listing.official_url,
  support_url: listing.support_url,
  privacy_policy_url: listing.privacy_policy_url,
  test_instructions_url: listing.reviewer_instructions_url,
  github_topics: [
    "chrome-extension",
    "chrome-web-store",
    "session-manager",
    "local-first",
    "tabs",
    "backup"
  ],
  extension: {
    name: manifest.name,
    version: manifest.version,
    summary: manifest.description,
    category: listing.category,
    chrome_min_version: manifest.minimum_chrome_version
  },
  release: {
    tag: `v${manifest.version}`,
    title: `Release Session Rescue v${manifest.version}`,
    zip: zipName
  },
  project_slug: "session-rescue"
}, null, 2)}\n`);

console.log(`Built ${zipPath}`);
