#!/usr/bin/env node
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const example = join(root, ".dev.vars.example");
const dest = join(root, ".dev.vars");

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  console.error(`steward needs Node 22.12 or later (found ${process.versions.node}).`);
  console.error("The runtime tests use --experimental-strip-types.");
  process.exit(1);
}

if (existsSync(example) && !existsSync(dest)) {
  copyFileSync(example, dest);
  console.log("wrote .dev.vars from .dev.vars.example");
} else if (existsSync(dest)) {
  console.log(".dev.vars already present");
} else {
  console.log("no .dev.vars.example found; skipping secret file");
}

console.log("");
console.log("Node", process.versions.node);
console.log("  npm test          runtime proofs (no Cloudflare account)");
console.log("  npm run proof     same proofs, printed as a ledger");
console.log("  npm run worker    local Worker + Durable Object");
console.log("  npm run deploy    wrangler deploy");
