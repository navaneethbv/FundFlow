/**
 * CI dependency gate: `npm audit` at high/critical, minus an explicit,
 * expiring allowlist of advisory IDs (scripts/audit-allowlist.json).
 *
 * `npm audit` has no ignore mechanism, so an advisory with no patched release
 * would otherwise block every PR. This keeps the gate blocking for everything
 * else: an allowlisted ID only suppresses that one advisory, and an entry past
 * its reviewBy date fails the run.
 *
 * Usage: node scripts/audit-gate.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const BLOCKING = new Set(["high", "critical"]);

const allowlist = JSON.parse(
  readFileSync(new URL("./audit-allowlist.json", import.meta.url), "utf8"),
).advisories;

const today = new Date().toISOString().slice(0, 10); // explicit UTC boundary
const expired = allowlist.filter((entry) => entry.reviewBy < today);
if (expired.length > 0) {
  for (const entry of expired) {
    console.error(`Allowlist entry ${entry.id} (${entry.package}) expired on ${entry.reviewBy}; re-review or remove it.`);
  }
  process.exit(1);
}
const allowed = new Set(allowlist.map((entry) => entry.id));

let raw;
try {
  raw = execFileSync("npm", ["audit", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
} catch (error) {
  // npm audit exits non-zero whenever it finds anything; the JSON is still on stdout.
  raw = error.stdout;
  if (!raw) throw error;
}
const report = JSON.parse(raw);
if (report.error) {
  console.error("npm audit failed:", report.error.summary ?? report.error);
  process.exit(1);
}

// Each advisory appears as an object in the `via` list of the package it
// affects; dependants list it by package name only, so objects are the source.
const advisories = new Map();
for (const vuln of Object.values(report.vulnerabilities ?? {})) {
  for (const via of vuln.via) {
    if (typeof via === "object" && BLOCKING.has(via.severity)) {
      const id = via.url?.split("/").pop() ?? String(via.source);
      advisories.set(id, via);
    }
  }
}

const blocking = [...advisories].filter(([id]) => !allowed.has(id));
const tolerated = [...advisories].filter(([id]) => allowed.has(id));

for (const [id, via] of tolerated) {
  console.log(`allowlisted: ${id} ${via.name} (${via.severity}) ${via.title}`);
}
if (blocking.length > 0) {
  for (const [id, via] of blocking) {
    console.error(`BLOCKING: ${id} ${via.name} ${via.range} (${via.severity}) ${via.title}`);
  }
  process.exit(1);
}
console.log(`audit gate passed: ${tolerated.length} allowlisted, 0 blocking high/critical advisories`);
