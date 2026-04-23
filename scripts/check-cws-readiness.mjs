#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const listing = JSON.parse(await readFile(join(root, "docs/cws/listing.json"), "utf8"));
const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const failures = [];

await validateVersions();
await validatePermissions();
await validateListingUrls();
await validatePrivacyPolicy();
await validateSiteSource();
await validatePackageSurface();
await validateAssets();
await validateLiveUrls();

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log(`CWS readiness passed for ${listing.name} ${manifest.version}`);
console.log(`Official URL: ${listing.official_url}`);
console.log(`Privacy URL: ${listing.privacy_policy_url}`);
console.log(`Support URL: ${listing.support_url}`);

async function validateVersions() {
  assert(manifest.version === packageJson.version, "manifest.json and package.json versions must match");
  assert(listing.version === manifest.version, "docs/cws/listing.json version must match manifest.json");
}

async function validatePermissions() {
  const permissions = new Set(manifest.permissions || []);
  const expected = new Set(Object.keys(listing.permission_justifications));
  assert(permissions.size === expected.size, "manifest permissions must match listing permission justifications exactly");
  for (const permission of expected) {
    assert(permissions.has(permission), `manifest missing justified permission ${permission}`);
  }
  for (const permission of ["storage", "history", "sessions", "downloads", "scripting", "cookies", "management"]) {
    assert(!permissions.has(permission), `manifest must not request ${permission}`);
  }
  assert(!manifest.host_permissions, "manifest must not request host_permissions for the MVP");
}

async function validateListingUrls() {
  const publicUrls = [
    "official_url",
    "homepage_url",
    "support_url",
    "privacy_policy_url",
    "reviewer_instructions_url",
  ];
  const allowedDomains = new Set(listing.allowed_public_domains || []);
  for (const field of publicUrls) {
    const value = listing[field];
    assert(value, `${field} is required`);
    let url;
    try {
      url = new URL(value);
    } catch {
      failures.push(`${field} is not a valid URL`);
      continue;
    }
    assert(url.protocol === "https:", `${field} must use HTTPS`);
    assert(allowedDomains.has(url.hostname), `${field} must be on an approved public site domain`);
    assert(!url.hostname.endsWith("github.com"), `${field} must not point directly to GitHub`);
    assert(!value.includes("/blob/"), `${field} must not point to a source viewer URL`);
  }
  assert(listing.source_url.startsWith("https://github.com/"), "source_url should point at the public source repo");
}

async function validatePrivacyPolicy() {
  const policy = await readFile(join(root, "docs/privacy-policy.md"), "utf8");
  const requiredTerms = [
    "Chrome Web Store User Data Policy",
    "Limited Use",
    "IndexedDB",
    "does not send tab URLs",
    "No ads",
    "sale of user data",
    "delete individual snapshots",
    listing.support_url,
  ];
  for (const term of requiredTerms) {
    assert(policy.includes(term), `privacy policy missing required term: ${term}`);
  }
}

async function validateSiteSource() {
  const pages = [
    ["site/index.html", "Session Rescue"],
    ["site/privacy/index.html", "Limited Use"],
    ["site/support/index.html", "Support"],
    ["site/review/index.html", "Reviewer"],
    ["site/_headers", "X-Content-Type-Options"],
  ];
  for (const [filePath, term] of pages) {
    const text = await readFile(join(root, filePath), "utf8");
    assert(text.includes(term), `${filePath} missing ${term}`);
  }
  const rootHtml = await readFile(join(root, "site/index.html"), "utf8");
  assert(rootHtml.includes("/privacy/"), "site root must link to privacy within one click");
  assert(rootHtml.includes("/support/"), "site root must link to support within one click");
}

async function validatePackageSurface() {
  const packageFiles = await collectPackageFiles(join(root, "src"));
  packageFiles.push(join(root, "manifest.json"));
  for (const icon of Object.values(manifest.icons || {})) {
    packageFiles.push(join(root, icon));
  }
  const remotePattern = /https?:\/\/|<script[^>]+src=["']https?:\/\/|eval\(|new Function\(/i;
  for (const filePath of packageFiles) {
    if (!/\.(js|html|json|css)$/.test(filePath)) {
      continue;
    }
    const text = await readFile(filePath, "utf8");
    assert(!remotePattern.test(text), `${relative(root, filePath)} contains a remote-code risk pattern`);
  }
}

async function validateAssets() {
  const expectedDimensions = {
    store_icon: [128, 128],
    screenshot: [1280, 800],
    small_promo: [440, 280],
    marquee_promo: [1400, 560],
  };
  for (const [key, assetPath] of Object.entries(listing.assets)) {
    const absolutePath = join(root, assetPath);
    const fileStat = await stat(absolutePath);
    assert(fileStat.size > 0, `${assetPath} is empty`);
    const dimensions = await readPngDimensions(absolutePath);
    const expected = expectedDimensions[key];
    assert(dimensions.width === expected[0] && dimensions.height === expected[1],
      `${assetPath} expected ${expected[0]}x${expected[1]}, got ${dimensions.width}x${dimensions.height}`);
  }
}

async function validateLiveUrls() {
  if (process.env.CWS_READINESS_OFFLINE === "1") {
    return;
  }
  for (const field of ["official_url", "support_url", "privacy_policy_url", "reviewer_instructions_url"]) {
    const response = await fetch(listing[field], { redirect: "follow" }).catch((error) => ({ error }));
    if (response.error) {
      failures.push(`${field} failed live check: ${response.error.message}`);
      continue;
    }
    assert(response.status === 200, `${field} returned HTTP ${response.status}`);
    const text = await response.text();
    assert(text.includes("Session Rescue"), `${field} live page does not contain Session Rescue`);
  }
}

async function collectPackageFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectPackageFiles(child));
    } else {
      files.push(child);
    }
  }
  return files;
}

async function readPngDimensions(filePath) {
  const buffer = await readFile(filePath);
  assert(buffer.toString("ascii", 1, 4) === "PNG", `${filePath} is not a PNG`);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function assert(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}
