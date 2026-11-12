"use strict";

// Standalone focused tests: run with `node --test` without Firebase credentials.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createAccountDeletionService } = require("../src/services/accountDeletionService");
const { cleanupDeletedAccount } = require("../../functions/accountCleanup");

function fixture() {
  const records = new Map();
  const events = [];
  const put = (path, data) => records.set(path, { ...data });
  put("users/alice", { uid: "alice", status: "active" });
  put("users/bob", { uid: "bob", status: "active" });
  put("users/carol", { uid: "carol", status: "active" });
  put("sessions/s-alice", { userId: "alice" });
  put("sessions/s-bob", { userId: "bob" });
  put("friendRelationships/pending", {
    participants: ["alice", "bob"], status: "pending", requesterUid: "alice", recipientUid: "bob",
  });
  put("friendRelationships/accepted", {
    participants: ["alice", "carol"], status: "accepted", requesterUid: "carol", recipientUid: "alice",
  });
  put("friendRelationships/declined", {
    participants: ["alice", "dave"], status: "declined", requesterUid: "alice", recipientUid: "dave",
  });
  put("friendRelationships/unrelated", {
    participants: ["bob", "carol"], status: "accepted", requesterUid: "bob", recipientUid: "carol",
  });
  put("usernames/alice", { uid: "alice" });
  put("usernames/bob", { uid: "bob" });
  put("users/alice/usage/x", { used: true });

  const select = (collection, filters, size) => [...records]
    .filter(([path]) => path.startsWith(`${collection}/`) && path.split("/").length === 2)
    .filter(([, data]) => filters.every(({ field, op, value }) =>
      op === "==" ? data[field] === value :
      op === "array-contains" && Array.isArray(data[field]) && data[field].includes(value)))
    .slice(0, size)
    .map(([path, data]) => ({
      id: path.split("/")[1], ref: reference(path), exists: true, data: () => ({ ...data }),
    }));

  function reference(path) {
    return {
      path, id: path.split("/").at(-1),
      async set(data, options) {
        events.push(`set:${path}`);
        records.set(path, options?.merge ? { ...records.get(path), ...data } : { ...data });
      },
      async listCollections() {
        const children = [...new Set([...records.keys()]
          .filter((name) => name.startsWith(`${path}/`))
          .map((name) => name.slice(path.length + 1).split("/")[0]))];
        return children.map((collection) => reference(`${path}/${collection}`));
      },
    };
  }

  function query(collection, filters = [], size = Infinity) {
    return {
      where(field, op, value) { return query(collection, [...filters, { field, op, value }], size); },
      limit(max) { return query(collection, filters, max); },
      async get() {
        const docs = select(collection, filters, size);
        events.push(`query:${collection}:${docs.length}`);
        return { empty: docs.length === 0, docs };
      },
      doc(id) { return reference(`${collection}/${id}`); },
    };
  }

  let failRelationshipOnce = false;
  const db = {
    collection: (name) => query(name),
    async recursiveDelete(ref) {
      events.push(`delete:${ref.path}`);
      if (failRelationshipOnce && ref.path.startsWith("friendRelationships/")) {
        failRelationshipOnce = false;
        throw new Error("friendship database unavailable");
      }
      for (const key of [...records.keys()]) {
        if (key === ref.path || key.startsWith(`${ref.path}/`)) records.delete(key);
      }
    },
    async runTransaction(callback) {
      return callback({
        get: async (ref) => ({
          exists: records.has(ref.path),
          data: () => records.get(ref.path),
        }),
        delete: (ref) => {
          events.push(`transactionDelete:${ref.path}`);
          records.delete(ref.path);
        },
      });
    },
  };
  const authClient = { async deleteUser(uid) {
    events.push(`authDelete:${uid}`);
  } };
  return {
    records, events, db, authClient,
    simulateFriendshipFailure() { failRelationshipOnce = true; },
    service: createAccountDeletionService({ db, authClient }),
  };
}

function assertFriendshipsPurged(f) {
  for (const path of ["pending", "accepted", "declined"]) {
    assert.equal(f.records.has(`friendRelationships/${path}`), false, path);
  }
  assert.equal(f.records.has("friendRelationships/unrelated"), true);
  assert.equal(f.records.has("sessions/s-bob"), true);
  assert.equal(f.records.has("usernames/bob"), true);
  assert.equal(f.records.has("users/bob"), true);
}

test("API deletion removes every friendship state, either request direction, and leaves unrelated records", async () => {
  const f = fixture();
  assert.deepEqual(await f.service.deleteAccount("alice"), { deleted: true, deletedSessions: 1 });
  assertFriendshipsPurged(f);
  const auth = f.events.indexOf("authDelete:alice");
  assert.ok(auth >= 0);
  for (const path of ["pending", "accepted", "declined"]) {
    assert.ok(f.events.indexOf(`delete:friendRelationships/${path}`) < auth);
  }
  assert.equal(f.records.has("users/alice"), false);
});

test("API cleanup failure happens before Auth deletion and is safe to retry", async () => {
  const f = fixture();
  f.simulateFriendshipFailure();
  await assert.rejects(f.service.deleteAccount("alice"), /friendship database unavailable/);
  assert.equal(f.records.get("users/alice").deleting, true);
  assert.equal(f.events.includes("authDelete:alice"), false);
  assert.equal(f.records.has("friendRelationships/unrelated"), true);
  await f.service.deleteAccount("alice");
  assertFriendshipsPurged(f);
  assert.equal(f.events.filter((item) => item === "authDelete:alice").length, 1);
});

test("Auth onDelete trigger removes relationships even without the API path and can rerun safely", async () => {
  const f = fixture();
  await cleanupDeletedAccount(f.db, "alice");
  assertFriendshipsPurged(f);
  assert.equal(f.records.has("users/alice"), false);
  await cleanupDeletedAccount(f.db, "alice");
  assertFriendshipsPurged(f);
});

test("Auth trigger propagates failed relationship deletion for scheduled retry", async () => {
  const f = fixture();
  f.simulateFriendshipFailure();
  await assert.rejects(cleanupDeletedAccount(f.db, "alice"), /friendship database unavailable/);
  assert.equal(f.records.has("users/alice"), true);
  await cleanupDeletedAccount(f.db, "alice");
  assertFriendshipsPurged(f);
});

test("deleting one participant removes only their relationships", async () => {
  const f = fixture();
  await f.service.deleteAccount("bob");
  // Bob is a participant in pending and unrelated; those records must be deleted.
  assert.equal(f.records.has("friendRelationships/pending"), false);
  assert.equal(f.records.has("friendRelationships/unrelated"), false);
  // Relationships that involve Alice and no Bob must remain untouched.
  assert.equal(f.records.has("friendRelationships/accepted"), true);
  assert.equal(f.records.has("friendRelationships/declined"), true);
});

test("cleanup handles a user with no relationships and preserves the deletion response contract", async () => {
  const f = fixture();
  f.records.set("users/erin", { uid: "erin" });
  const result = await f.service.deleteAccount("erin");
  assert.deepEqual(result, { deleted: true, deletedSessions: 0 });
  assert.equal(f.records.has("friendRelationships/pending"), true);
  assert.equal(f.records.has("friendRelationships/accepted"), true);
  assert.equal(f.records.has("friendRelationships/declined"), true);
  assert.equal(f.records.has("friendRelationships/unrelated"), true);
});

test("API and Auth cleanup page through more than 50 friend relationship documents", async () => {
  for (const mode of ["api", "trigger"]) {
    const f = fixture();
    for (let i = 0; i < 109; i += 1) {
      f.records.set(`friendRelationships/extra-${i}`, {
        participants: ["alice", `friend-${i}`], status: "pending",
      });
    }
    if (mode === "api") await f.service.deleteAccount("alice");
    else await cleanupDeletedAccount(f.db, "alice");
    assertFriendshipsPurged(f);
    assert.equal([...f.records.keys()].filter((path) =>
      path.startsWith("friendRelationships/") && path !== "friendRelationships/unrelated").length, 0);
    assert.ok(f.events.filter((event) => event.startsWith("query:friendRelationships:")).length >= 4);
  }
});
