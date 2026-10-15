import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const script = join(dirname(fileURLToPath(import.meta.url)), "smoke-test.mjs");
const SHA = "0123456789012345678901234567890123456789";
const VERSION = "IB-build-12.1-0123456";

async function withServer({ faulty = false } = {}, run) {
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url.startsWith("/api/health")) {
      res.end(JSON.stringify({
        status: "ok",
        service: "interview-buddy-api",
        buildVersion: VERSION,
        sourceCommitSha: faulty ? "incorrect" : SHA,
      }));
    } else if (req.url.startsWith("/api/questions/options")) {
      res.statusCode = 401;
      res.end(JSON.stringify({ code: req.headers.authorization ? "invalid-auth-token" : "auth-token-required" }));
    } else if (req.url.startsWith("/deployment-info.json")) {
      res.end(JSON.stringify({ buildVersion: VERSION, sourceCommitSha: SHA }));
    } else {
      res.setHeader("Content-Type", "text/html");
      res.end('<html><title>Interview Buddy</title><div id="root"></div></html>');
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// Run the CLI as an asynchronous child because spawnSync would block the
// in-process HTTP fixture server from serving requests.
import { spawn } from "node:child_process";
function runCli(baseUrl) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, BASE_URL: baseUrl, EXPECTED_SHA: SHA, EXPECTED_VERSION: VERSION },
    });
    let output = "";
    child.stdout.on("data", (data) => { output += data; });
    child.stderr.on("data", (data) => { output += data; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });
}

test("production smoke suite passes against healthy mock endpoints", async () => {
  await withServer({}, async (url) => {
    const result = await runCli(url);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /Smoke checks: 8\/8 passed/);
  });
});

test("smoke suite fails when backend revision is wrong", async () => {
  await withServer({ faulty: true }, async (url) => {
    const result = await runCli(url);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /backend commit mismatch/);
  });
});
