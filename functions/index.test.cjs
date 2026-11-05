"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

test("CI/CD-25: deployed Cloud Function wires the expected Firestore trigger and handler", async () => {
  const originalLoad = Module._load;
  const entry = require.resolve("./index.js");
  let initialized = 0;
  let registered;
  const writes = [];
  Module._load = function (request, parent, isMain) {
    if (request === "firebase-functions/v2/firestore") {
      return { onDocumentWritten(options, handler) {
        registered = options;
        return { handleEvent: handler };
      } };
    }
    if (request === "firebase-admin/app") {
      return { initializeApp() { initialized += 1; } };
    }
    if (request === "firebase-admin/firestore") {
      return {
        getFirestore() {
          return { doc(path) {
            return { async set(payload, options) { writes.push({ path, payload, options }); } };
          } };
        },
        FieldValue: {
          increment: (n) => ({ increment: n }),
          serverTimestamp: () => ({ timestamp: true }),
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  let deployed;
  try {
    delete require.cache[entry];
    deployed = require(entry);
  } finally {
    Module._load = originalLoad;
    delete require.cache[entry];
  }

  assert.equal(initialized, 1);
  assert.deepEqual(registered, {
    document: "questions/{questionId}", region: "us-west1", minInstances: 0,
  });
  await deployed.invalidateQuestionMetadata.handleEvent({
    data: {
      before: { exists: false },
      after: { exists: true, data: () => ({ mode: "Code Style", tags: ["bfs"] }) },
    },
  });
  assert.deepEqual(writes, [{
    path: "metadata/questionCatalog",
    payload: { version: { increment: 1 }, updatedAt: { timestamp: true } },
    options: { merge: true },
  }]);
});
