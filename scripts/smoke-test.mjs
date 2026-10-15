#!/usr/bin/env node
/**
 * DEPLOY-4: HTTP smoke checks for Cloud Run and Firebase Hosting.
 * This does not replace a real-browser authentication/navigation test.
 *
 * BASE_URL=https://... EXPECTED_SHA=<full CI commit> EXPECTED_VERSION=<CI build id> \
 *   node scripts/smoke-test.mjs [--backend-only]
 */
import { appendFileSync } from "node:fs";

const backendOnly = process.argv.includes("--backend-only");
const baseUrl = (process.env.BASE_URL || "").replace(/\/+$/, "");
const expectedSha = process.env.EXPECTED_SHA;
const expectedVersion = process.env.EXPECTED_VERSION;

if (!/^https?:\/\//.test(baseUrl) || !expectedSha || !expectedVersion) {
  console.error("Required: BASE_URL, EXPECTED_SHA, EXPECTED_VERSION");
  process.exit(2);
}

const checks = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(path, { attempts = 5, ...options } = {}) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        signal: AbortSignal.timeout(12000),
        headers: { "Cache-Control": "no-cache", ...options.headers },
      });
      // A 401 is expected for unauthenticated protected API requests.
      if (response.status >= 500 || response.status === 404) {
        throw new Error(`${path}: HTTP ${response.status}`);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (i !== attempts - 1) await sleep(2000);
    }
  }
  throw lastError;
}

async function check(name, action) {
  try {
    await action();
    checks.push({ name, ok: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    checks.push({ name, ok: false });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

function assert(condition, explanation) {
  if (!condition) throw new Error(explanation);
}

async function requireJson(response, path) {
  assert(response.status === 200, `${path}: expected HTTP 200, got ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new Error(`${path}: invalid JSON response`);
  }
}

await check("API is available and matches the CI build", async () => {
  const health = await requireJson(await fetchWithRetry("/api/health"), "/api/health");
  assert(health.status === "ok" && health.service === "interview-buddy-api", "unexpected backend health response");
  assert(health.sourceCommitSha === expectedSha, `backend commit mismatch: ${health.sourceCommitSha}`);
  assert(health.buildVersion === expectedVersion, `backend build mismatch: ${health.buildVersion}`);
});

await check("Protected API denies anonymous requests", async () => {
  const response = await fetchWithRetry("/api/questions/options?mode=Quiz%20Style");
  assert(response.status === 401, `expected HTTP 401, got ${response.status}`);
  const data = await response.json();
  assert(data.code === "auth-token-required", "unexpected anonymous-auth rejection code");
});

await check("Protected API denies invalid bearer tokens", async () => {
  const response = await fetchWithRetry("/api/questions/options?mode=Quiz%20Style", {
    headers: { Authorization: "Bearer invalid-smoke-token" },
  });
  assert(response.status === 401, `expected HTTP 401, got ${response.status}`);
  const data = await response.json();
  assert(data.code === "invalid-auth-token", "unexpected invalid-token rejection code");
});

if (!backendOnly) {
  await check("Frontend build matches the tested CI artifact", async () => {
    const info = await requireJson(await fetchWithRetry("/deployment-info.json"), "/deployment-info.json");
    assert(info.sourceCommitSha === expectedSha, `frontend commit mismatch: ${info.sourceCommitSha}`);
    assert(info.buildVersion === expectedVersion, `frontend build mismatch: ${info.buildVersion}`);
  });

  for (const path of ["/", "/login", "/register", "/dashboard"]) {
    await check(`Frontend serves React SPA at ${path}`, async () => {
      const response = await fetchWithRetry(path);
      assert(response.status === 200, `${path}: HTTP ${response.status}`);
      const html = await response.text();
      assert(html.includes('id="root"') && html.includes("Interview Buddy"), `${path}: React HTML shell not found`);
    });
  }
}

const failed = checks.filter((item) => !item.ok);
const outcome = failed.length ? "FAIL" : "PASS";
const summary = [
  `### Deployment smoke tests: ${outcome}`,
  `Target: ${baseUrl}`,
  `Expected build: ${expectedVersion}`,
  `Expected commit: ${expectedSha}`,
  "",
  "| Check | Result |",
  "|---|---|",
  ...checks.map((item) => `| ${item.name} | ${item.ok ? "PASS" : "FAIL"} |`),
  "",
].join("\n");
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}
console.log(`Smoke checks: ${checks.length - failed.length}/${checks.length} passed`);
if (failed.length) process.exitCode = 1;
