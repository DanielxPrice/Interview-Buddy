"use strict";
// SCRUM-253: parse ACTUAL Node TAP totals after the emulator command finishes.
// Never claim a pass if the command fails, totals are absent, or tests fail.
const fs = require("node:fs");
const path = require("node:path");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
}
const input = argument("--log");
const output = argument("--output");
const exitCode = Number(argument("--exit-code"));
if (!input || !output || !Number.isInteger(exitCode)) {
  console.error("Usage: node scripts/summarize-firestore-security.cjs --log LOG --output JSON --exit-code N");
  process.exit(2);
}
const log = fs.readFileSync(input, "utf8").replace(/\x1b\[[0-9;]*m/g, "");
const counts = {};
for (const key of ["tests", "suites", "pass", "fail", "cancelled", "skipped", "todo"]) {
  const matches = [...log.matchAll(new RegExp(`^\\s*(?:#|\u2139)\\s+${key}\\s+(\\d+)\\s*$`, "gm"))];
  counts[key] = matches.length ? Number(matches.at(-1)[1]) : null;
}
const matrix = [...log.matchAll(/H-SOC-05 MATRIX (anonymous|authenticated) (read|write) (users|sessions|questions|serverConfig)\/([^\s:]+): DENIED \(expected\)/g)]
  .map((match) => ({ auth: match[1], operation: match[2], path: `${match[3]}/${match[4]}`, decision: "DENIED" }));
const uniqueMatrix = new Set(matrix.map((row) => `${row.auth}:${row.operation}:${row.path}`));
const summary = {
  criterion: "SOC 2 CC6.3", jira: ["SCRUM-251", "SCRUM-253"],
  generatedAt: new Date().toISOString(),
  environment: "isolated Firebase Auth + Firestore Emulators; demo-interview-buddy-tests",
  sourceCommitSha: process.env.GITHUB_SHA || log.match(/^Git revision:\s*([0-9a-f]{40})\s*$/m)?.[1] || "unavailable (archive/local checkout)",
  commandExitCode: exitCode,
  status: exitCode === 0 && counts.fail === 0 && counts.cancelled === 0 &&
    counts.tests !== null && counts.pass === counts.tests && uniqueMatrix.size === 16 ? "PASS" : "FAIL",
  actualCounts: counts,
  matrixCombinationCount: uniqueMatrix.size,
  expectedCombinationCount: 16,
  matrix,
  unverifiedLiveDeployment: "H-SOC-07 is assessed separately; emulator PASS is not deployed-rule evidence",
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`H-SOC evidence: ${summary.status}; ${counts.pass ?? "?"}/${counts.tests ?? "?"} tests; ${uniqueMatrix.size}/16 matrix entries; exit ${exitCode}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### Firestore SOC 2 CC6.3 emulator evidence\n` +
    `Status: **${summary.status}** | Tests: ${counts.pass ?? "?"}/${counts.tests ?? "?"} | ` +
    `Failed: ${counts.fail ?? "?"} | Cancelled: ${counts.cancelled ?? "?"} | Skipped: ${counts.skipped ?? "?"} | ` +
    `H-SOC-05 matrix: ${uniqueMatrix.size}/16 | Commit: ${summary.sourceCommitSha}\n`);
}
if (summary.status !== "PASS") process.exitCode = 1;
