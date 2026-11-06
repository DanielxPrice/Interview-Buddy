#!/usr/bin/env node
// SCRUM-252 / H-SOC-07: read-only comparison of the active Firebase Rules API
// release against the reviewed repository configuration. Never deploys rules.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const normalized = (s) => s.replace(/\r\n/g, '\n').trimEnd() + '\n';
const digest = (s) => crypto.createHash('sha256').update(normalized(s)).digest('hex');

export function compareRules(localContent, deployedFiles) {
  if (!Array.isArray(deployedFiles) || deployedFiles.length !== 1 ||
      typeof deployedFiles[0]?.content !== 'string') {
    return { match: false, reason: 'Expected exactly one readable deployed rules source file' };
  }
  return {
    match: normalized(localContent) === normalized(deployedFiles[0].content),
    deployedSha256: digest(deployedFiles[0].content),
    deployedFile: deployedFiles[0].name ?? null,
  };
}

export async function getActiveRules({ projectId, accessToken, fetchImpl = fetch }) {
  const base = `https://firebaserules.googleapis.com/v1/projects/${encodeURIComponent(projectId)}`;
  async function getJson(url) {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      throw new Error(`Firebase Rules API HTTP ${response.status}; verify read permissions and selected project`);
    }
    return response.json();
  }
  const release = await getJson(`${base}/releases/cloud.firestore`);
  const rulesetName = release.rulesetName;
  if (typeof rulesetName !== 'string' ||
      !new RegExp(`^projects/${projectId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/rulesets/[A-Za-z0-9_-]+$`).test(rulesetName)) {
    throw new Error('No valid active cloud.firestore ruleset for the selected project');
  }
  const ruleset = await getJson(`https://firebaserules.googleapis.com/v1/${rulesetName}`);
  return {
    releaseName: release.name ?? `projects/${projectId}/releases/cloud.firestore`,
    releaseUpdatedAt: release.updateTime ?? null,
    rulesetName,
    rulesetCreatedAt: ruleset.createTime ?? null,
    files: ruleset.source?.files,
  };
}

function sourceRevision() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try { return execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return 'unavailable (archive has no .git directory)'; }
}

async function main() {
  const args = process.argv.slice(2);
  const projectFlag = args.indexOf('--project');
  const outputFlag = args.indexOf('--output');
  const project = projectFlag >= 0 ? args[projectFlag + 1] : null;
  const output = outputFlag >= 0 ? args[outputFlag + 1] : null;
  if (!project || !/^[a-z][a-z0-9-]{4,29}$/.test(project)) {
    console.error('Usage: node scripts/verify-deployed-firestore-rules.mjs --project FIREBASE_PROJECT_ID [--output evidence.json]');
    process.exitCode = 2; return;
  }
  const firebaseConfig = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'));
  const rulesPath = firebaseConfig.firestore?.rules;
  if (!rulesPath || path.isAbsolute(rulesPath) ||
      path.normalize(rulesPath).startsWith('..')) {
    throw new Error('firebase.json does not reference a safe Firestore rules path');
  }
  const expectedProject = JSON.parse(fs.readFileSync(path.join(root, '.firebaserc'), 'utf8')).projects?.default;
  const localContent = fs.readFileSync(path.join(root, rulesPath), 'utf8');
  const result = {
    case: 'H-SOC-07', criterion: 'CC6.3', checkedAt: new Date().toISOString(),
    environmentProject: project, repositoryProject: expectedProject,
    repositorySha: sourceRevision(), repositoryRulesFile: rulesPath,
    repositoryRulesSha256: digest(localContent),
    status: 'INCONCLUSIVE',
  };
  try {
    if (project !== expectedProject) {
      result.reason = 'Requested Firebase project does not match .firebaserc; refused comparison';
    } else if (!process.env.FIREBASE_RULES_ACCESS_TOKEN) {
      result.reason = 'No access token supplied; deployed rules were not inspected';
    } else {
      const active = await getActiveRules({ projectId: project, accessToken: process.env.FIREBASE_RULES_ACCESS_TOKEN });
      Object.assign(result, {
        releaseName: active.releaseName, releaseUpdatedAt: active.releaseUpdatedAt,
        rulesetName: active.rulesetName, rulesetCreatedAt: active.rulesetCreatedAt,
      });
      const comparison = compareRules(localContent, active.files);
      Object.assign(result, comparison);
      result.status = comparison.match ? 'PASS' : 'FAIL';
      if (!comparison.match) result.reason = comparison.reason ?? 'Deployed rules content differs from approved repository rules';
    }
  } catch (error) {
    result.reason = error.message;
  }
  const outputJson = `${JSON.stringify(result, null, 2)}\n`;
  console.log(outputJson);
  if (output) {
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    fs.writeFileSync(path.resolve(output), outputJson, { mode: 0o600 });
  }
  process.exitCode = result.status === 'PASS' ? 0 : result.status === 'FAIL' ? 1 : 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error('INCONCLUSIVE:', error.message); process.exitCode = 2; });
}
