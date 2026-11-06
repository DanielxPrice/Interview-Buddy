#!/usr/bin/env node
// Cross-platform H-SOC-07 deployed Firestore rules verification (SCRUM-252).
// Run: npm run test:soc:deployed
// This runner is READ ONLY: it never deploys rules or writes Firestore data.
// Uses FIREBASE_RULES_ACCESS_TOKEN if provided, otherwise `gcloud auth print-access-token`.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = path.join(root, 'docs', 'testing', 'H-SOC');
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/[.Z]/g, '') + `-${process.pid}`;

function flag(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
}

function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const projectFromConfig = JSON.parse(fs.readFileSync(path.join(root, '.firebaserc'), 'utf8')).projects.default;
  const project = flag('--project') || projectFromConfig;
  const output = path.resolve(root, flag('--output') ||
    path.join(evidenceDir, `h-soc-07-deployed-rules-${stamp}.json`));
  let accessToken = process.env.FIREBASE_RULES_ACCESS_TOKEN?.trim();

  if (!accessToken) {
    // Static command and parameters: no user input is passed to a shell.
    // Windows installs gcloud as a .cmd script, so it requires shell mode.
    const auth = spawnSync('gcloud', ['auth', 'print-access-token'], {
      cwd: root, encoding: 'utf8', shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024,
    });
    if (!auth.error && auth.status === 0 && auth.stdout?.trim()) {
      accessToken = auth.stdout.trim();
    } else {
      console.error('No authorized gcloud token available. Run gcloud auth login, or provide FIREBASE_RULES_ACCESS_TOKEN.');
      console.error('H-SOC-07 will be reported as INCONCLUSIVE, not PASS.');
    }
  }

  const result = spawnSync(process.execPath, [
    path.join(root, 'scripts', 'verify-deployed-firestore-rules.mjs'),
    '--project', project, '--output', output,
  ], {
    cwd: root, env: { ...process.env, FIREBASE_RULES_ACCESS_TOKEN: accessToken || '' },
    stdio: 'inherit',
  });
  console.log(`Read-only deployed-rules evidence: ${output}`);
  if (result.error) console.error('Unable to run deployed-rules verifier:', result.error.message);
  process.exitCode = result.error ? 2 : (result.status ?? 2);
}

try { main(); }
catch (error) { console.error('H-SOC-07 verification failed:', error.message); process.exitCode = 2; }
