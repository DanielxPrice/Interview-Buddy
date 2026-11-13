#!/usr/bin/env node
// CI/CD-20 (SCRUM-187): safe, cross-platform Firebase session integration runner.
// Firebase CLI is pinned to the same version used by the existing H-SOC runner.
// A demo project is REQUIRED; the live .firebaserc default is never selected.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath;
if (!npmCli || !fs.existsSync(npmCli)) {
  console.error('Run this command through npm: npm run test:session:firebase');
  process.exitCode = 1;
} else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('CI/CD-20 refuses to start while production Firebase credentials are configured.');
  process.exitCode = 1;
} else {
  console.log('CI/CD-20: Firebase Auth + Firestore Emulators ONLY');
  console.log('Project: demo-interview-buddy-tests (never the live project)');
  const child = spawn(process.execPath, [
    npmCli, 'exec', '--yes', '--package=firebase-tools@14.12.0', '--',
    'firebase', 'emulators:exec',
    '--only', 'auth,firestore',
    '--project', 'demo-interview-buddy-tests',
    '--non-interactive',
    'npm --prefix server run test:session:emulator',
  ], { cwd: root, env: process.env, stdio: 'inherit' });
  child.on('error', (error) => {
    console.error(`Cannot start Firebase Emulator: ${error.message}`);
    process.exitCode = 1;
  });
  child.on('close', (code) => {
    process.exitCode = code ?? 1;
  });
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
}
