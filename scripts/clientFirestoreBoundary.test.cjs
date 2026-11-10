"use strict";

// H-03: React must not circumvent the server-side repository/API boundary.
// This is a conservative source-level regression check, not a substitute for
// Firestore client-rules tests or Bryan's HTTP authorization suite.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sourceRoot = path.join(__dirname, "..", "src");
const directFirestoreImport = /[\"'`](?:@firebase\/firestore|firebase\/(?:firestore|compat\/firestore))(?:\/[^\"'`]*)?[\"'`]/;

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    return entry.isFile() && /\.(?:js|jsx|ts|tsx)$/.test(entry.name) ? [fullPath] : [];
  });
}

test("H-03: React src never imports the direct Firestore client SDK", () => {
  const violations = sourceFiles(sourceRoot).filter((filename) =>
    directFirestoreImport.test(fs.readFileSync(filename, "utf8"))
  ).map((filename) => path.relative(sourceRoot, filename));
  assert.deepEqual(violations, [],
    "Direct Firestore client SDK imports circumvent the application API boundary");
});
