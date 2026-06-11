#!/usr/bin/env node

import { access } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

const requiredAssets = [
  "assets/icon-16.png",
  "assets/icon-32.png",
  "assets/icon-48.png",
  "assets/icon-128.png",
  "docs/cws/assets/store-icon-128.png",
  "docs/cws/assets/screenshot-1-save-restore-1280x800.png",
  "docs/cws/assets/screenshot-2-library-1280x800.png",
  "docs/cws/assets/screenshot-3-portable-backup-1280x800.png",
  "docs/cws/assets/screenshot-4-real-popup-flow-1280x800.png",
  "docs/cws/assets/screenshot-5-real-library-flow-1280x800.png",
  "docs/cws/assets/promo-small-440x280.png",
  "docs/cws/assets/promo-marquee-1400x560.png",
];

const missing = [];
for (const asset of requiredAssets) {
  try {
    await access(join(root, asset));
  } catch {
    missing.push(asset);
  }
}

if (missing.length) {
  throw new Error(`Missing approved Session Rescue media assets:\n${missing.map((asset) => `- ${asset}`).join("\n")}`);
}

console.log("Verified approved Session Rescue extension icons and CWS media.");
