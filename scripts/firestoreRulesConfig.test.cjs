"use strict";
// Source-level preflight: catches accidental local permission exceptions even
// before the emulator starts. The emulator remains the authority on behavior.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");

test("H-SOC / CC6.3: Firebase configuration references reviewed rules", () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, "firebase.json"), "utf8"));
  assert.equal(config.firestore?.rules, "firestore.rules");
});

test("H-SOC / CC6.3: repository policy has no direct-client permission exceptions", () => {
  const rules = fs.readFileSync(path.join(root, "firestore.rules"), "utf8")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, "");
  const expected = "rules_version='2';servicecloud.firestore{" +
    "match/databases/{database}/documents{" +
    "match/{document=**}{allowread,write:iffalse;}}}";
  // This flag is for a safe, intentionally failing CI security-gate probe.
  // It cannot grant access and is never enabled in production or normal tests.
  assert.equal(rules, process.env.H_SOC_FORCE_FAIL === "1" ? "deliberately-wrong-policy" : expected);
});
