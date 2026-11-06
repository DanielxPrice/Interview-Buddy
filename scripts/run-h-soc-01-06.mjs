#!/usr/bin/env node
// Cross-platform runner for H-SOC-01 through H-SOC-06 (SCRUM-251 / SCRUM-253).
// Run from the project root with: npm run test:soc
// Requires Node.js/npm, Java 21+, and installed project/server dependencies.
// Uses isolated Firebase Auth/Firestore emulators; NEVER accesses production data.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = path.join(root, 'docs', 'testing', 'H-SOC');
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/[.Z]/g, '') + `-${process.pid}`;
const logFile = path.join(evidenceDir, `firestore-soc-01-06-${stamp}.txt`);
const jsonFile = path.join(evidenceDir, `firestore-soc-01-06-${stamp}-summary.json`);
const textFile = path.join(evidenceDir, `firestore-soc-01-06-${stamp}-summary.txt`);
const startedAt = new Date().toISOString();

function revision() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch { return 'unavailable (archive/local directory without Git revision)'; }
}

function runAndRecord(command, args, fd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: root, env: process.env, stdio: ['inherit', 'pipe', 'pipe'] });
    let resolved = false;
    function done(code) {
      if (resolved) return;
      resolved = true;
      process.removeListener('SIGINT', interrupt);
      resolve(code);
    }
    function interrupt() { child.kill('SIGINT'); }
    process.on('SIGINT', interrupt);
    const relay = (destination) => (chunk) => {
      fs.writeSync(fd, chunk);
      destination.write(chunk);
    };
    child.stdout.on('data', relay(process.stdout));
    child.stderr.on('data', relay(process.stderr));
    child.on('error', (error) => {
      const message = `Unable to start Firebase Emulator command: ${error.message}\n`;
      fs.writeSync(fd, message);
      console.error(message.trim());
      done(1);
    });
    child.on('close', (code) => done(code ?? 1));
  });
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const sha = revision();
  const header = [
    'Interview Buddy | Firestore SOC 2 H-SOC-01 through H-SOC-06',
    `Started (UTC): ${startedAt}`,
    `Git revision: ${sha}`,
    'Firebase project: demo-interview-buddy-tests (emulators only)',
    'Emulators: auth 127.0.0.1:9099, firestore 127.0.0.1:8089',
    'Test command: npm --prefix server run test:emulator',
    'Expected coverage: H-SOC-01 to H-SOC-06, including 16-case H-SOC-05 matrix',
    'Note: PERMISSION_DENIED output is expected in denied-access tests.',
    '--- Actual emulator test output ---', '',
  ].join('\n');
  const fd = fs.openSync(logFile, 'w');
  fs.writeSync(fd, header);
  console.log(`Recording Firestore emulator output: ${logFile}`);

  let emulatorExitCode = 1;
  try {
    // npm_execpath is set by npm run and points to npm-cli.js on Windows,
    // macOS, and Linux. Running it through Node avoids cmd/pwsh/bash wrappers.
    const npmCli = process.env.npm_execpath;
    if (!npmCli || !fs.existsSync(npmCli)) {
      const error = 'Run this through npm: npm run test:soc (npm_execpath was not available).\n';
      fs.writeSync(fd, error);
      console.error(error.trim());
    } else {
      emulatorExitCode = await runAndRecord(process.execPath, [
        npmCli, 'exec', '--yes', '--package=firebase-tools@14.12.0', '--',
        'firebase', 'emulators:exec',
        '--only', 'auth,firestore',
        '--project', 'demo-interview-buddy-tests',
        '--non-interactive',
        'npm --prefix server run test:emulator',
      ], fd);
    }
  } finally {
    fs.closeSync(fd);
  }

  const summaryProcess = await new Promise((resolve) => {
    const child = spawn(process.execPath, [
      path.join(root, 'scripts', 'summarize-firestore-security.cjs'),
      '--log', logFile, '--output', jsonFile, '--exit-code', String(emulatorExitCode),
    ], { cwd: root, env: process.env, stdio: 'inherit' });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });
  const finishedAt = new Date().toISOString();
  let parsedStatus = 'FAIL';
  let counts = null;
  let matrixCount = 0;
  try {
    const evidence = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
    parsedStatus = evidence.status;
    counts = evidence.actualCounts;
    matrixCount = evidence.matrixCombinationCount;
  } catch { /* The summary parser's exit code still marks this execution failed. */ }
  const successful = emulatorExitCode === 0 && summaryProcess === 0 && parsedStatus === 'PASS';
  fs.writeFileSync(textFile, [
    'Interview Buddy | Firestore SOC 2 H-SOC-01 through H-SOC-06 execution summary',
    `Start (UTC): ${startedAt}`,
    `Finish (UTC): ${finishedAt}`,
    `Git revision: ${sha}`,
    `Emulator exit code: ${emulatorExitCode}`,
    `Evidence parser exit code: ${summaryProcess}`,
    `Actual tests: ${counts?.pass ?? '?'} passed / ${counts?.tests ?? '?'} total; ${counts?.fail ?? '?'} failed`,
    `Sensitive-collection matrix combinations: ${matrixCount}/16`,
    `Outcome: ${successful ? 'PASS' : 'FAIL'}`,
    'Scope: local emulators only; does not prove deployed rules or backend API authorization.',
    `Log: ${logFile}`,
    `JSON: ${jsonFile}`,
    '',
  ].join('\n'));
  console.log(`Full test log: ${logFile}`);
  console.log(`Jira summary: ${textFile}`);
  console.log(`JSON matrix and counts: ${jsonFile}`);
  process.exitCode = successful ? 0 : (emulatorExitCode || summaryProcess || 1);
}

main().catch((error) => {
  console.error('Firestore SOC 2 test runner failed:', error.message);
  process.exitCode = 1;
});
