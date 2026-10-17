const test = require("node:test");
const assert = require("node:assert/strict");
const { shouldInvalidateMetadata } = require("./relevantMetadata");

const question = {
  mode: "Code Style", active: true,
  tags: ["bfs"], jobRoles: ["software engineer"],
  experienceLevels: ["Beginner"],
};

test("manual question creation and deletion invalidate the catalog", () => {
  assert.equal(shouldInvalidateMetadata(null, question), true);
  assert.equal(shouldInvalidateMetadata(question, null), true);
});

test("a newly assigned seed marker skips per-question invalidation", () => {
  assert.equal(shouldInvalidateMetadata(null, { ...question, _metadataSeedBatchId: "seed-1" }), false);
  assert.equal(shouldInvalidateMetadata(
    { ...question, _metadataSeedBatchId: "seed-1" },
    { ...question, tags: ["graphs"], _metadataSeedBatchId: "seed-2" }
  ), false);
});

test("manual changes to seeded questions still invalidate", () => {
  const before = { ...question, _metadataSeedBatchId: "seed-1" };
  assert.equal(shouldInvalidateMetadata(before, { ...before, tags: ["graphs"] }), true);
  assert.equal(shouldInvalidateMetadata(before, null), true);
});

test("timestamp-only changes and semantically identical tags do not invalidate", () => {
  assert.equal(shouldInvalidateMetadata(question, { ...question, updatedAt: "2026-10-14" }), false);
  assert.equal(shouldInvalidateMetadata(question, { ...question, tags: ["BFS", "bfs"] }), false);
});
