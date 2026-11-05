"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { processMetadataInvalidationEvent } = require("./metadataInvalidationHandler");

const question = {
  mode: "Code Style", active: true, tags: ["bfs"],
  jobRoles: ["software engineer"], experienceLevels: ["Beginner"],
};

function event(before, after) {
  const wrap = (value) => ({ exists: value !== null, data: () => value });
  return { data: { before: wrap(before), after: wrap(after) } };
}

function fixture({ fail = false } = {}) {
  const calls = [];
  let writes = 0;
  const firestore = {
    doc(path) {
      calls.push(["doc", path]);
      return {
        async set(data, options) {
          calls.push(["set", data, options]);
          if (fail) throw new Error("Firestore unavailable");
          writes += 1;
        },
      };
    },
  };
  const deps = {
    getDb() { calls.push(["getDb"]); return firestore; },
    FieldValue: {
      increment: (amount) => ({ op: "increment", amount }),
      serverTimestamp: () => ({ op: "serverTimestamp" }),
    },
  };
  return { calls, deps, get writes() { return writes; } };
}

test("CI/CD-25: created question triggers atomic metadata invalidation", async () => {
  const f = fixture();
  assert.equal(await processMetadataInvalidationEvent(event(null, question), f.deps), true);
  assert.deepEqual(f.calls, [
    ["getDb"], ["doc", "metadata/questionCatalog"],
    ["set", {
      version: { op: "increment", amount: 1 },
      updatedAt: { op: "serverTimestamp" },
    }, { merge: true }],
  ]);
  assert.equal(f.writes, 1);
});

test("CI/CD-25: metadata edit and manual deletion invalidate", async () => {
  for (const input of [
    event(question, { ...question, tags: ["graphs"] }),
    event(question, null),
  ]) {
    const f = fixture();
    assert.equal(await processMetadataInvalidationEvent(input, f.deps), true);
    assert.equal(f.writes, 1);
  }
});

test("CI/CD-25: seed operations, irrelevant edits and malformed empty events are no-ops", async () => {
  for (const input of [
    event(null, { ...question, _metadataSeedBatchId: "seed-2" }),
    event(question, { ...question, referenceAnswer: "changed private content" }),
    event(question, { ...question, tags: ["BFS", "bfs"] }),
    event(null, null),
    {},
    null,
  ]) {
    const f = fixture();
    assert.equal(await processMetadataInvalidationEvent(input, f.deps), false);
    assert.deepEqual(f.calls, []);
  }
});

test("CI/CD-25: failed Firestore write is reported, never misrepresented as success", async () => {
  const f = fixture({ fail: true });
  await assert.rejects(processMetadataInvalidationEvent(event(null, question), f.deps),
    /Firestore unavailable/);
  assert.equal(f.writes, 0);
});
