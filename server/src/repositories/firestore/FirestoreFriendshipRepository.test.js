"use strict";

// Runs under both the existing Jest suite and Node's dependency-free test runner.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const runner = typeof globalThis.test === "function" && typeof globalThis.describe === "function"
  ? globalThis
  : require("node:test");
const { describe, test } = runner;
const FriendshipRepository = require("./FirestoreFriendshipRepository");

function fakeFirestore() {
  const docs = new Map();
  const calls = { getAll: [], queries: [] };
  function snapshot(path) {
    const exists = docs.has(path);
    return { id: path.split("/").at(-1), exists, data: () => docs.get(path) };
  }
  function ref(path) {
    return { path, id: path.split("/").at(-1), get: async () => snapshot(path) };
  }
  class Query {
    constructor(path, filters = []) { this.path = path; this.filters = filters; }
    doc(id) { return ref(`${this.path}/${id}`); }
    where(field, op, value) {
      return new Query(this.path, [...this.filters, { field, op, value }]);
    }
    async get() {
      calls.queries.push(this.filters);
      const results = [...docs.keys()]
        .filter((path) => path.startsWith(`${this.path}/`) && path.split("/").length === 2)
        .map((path) => snapshot(path))
        .filter((doc) => this.filters.every(({ field, op, value }) => {
          const stored = doc.data()?.[field];
          return op === "==" ? stored === value :
            op === "array-contains" ? Array.isArray(stored) && stored.includes(value) : false;
        }));
      return { docs: results, empty: results.length === 0 };
    }
  }
  const db = {
    collection: (path) => new Query(path),
    async getAll(...args) {
      const options = args.pop();
      calls.getAll.push({ ids: args.map((r) => r.id), options });
      return args.map((item) => {
        const full = snapshot(item.path);
        if (!full.exists) return full;
        const fields = Object.fromEntries(
          Object.entries(full.data()).filter(([key]) => options.fieldMask.includes(key))
        );
        return { ...full, data: () => fields };
      });
    },
    async runTransaction(callback) {
      const operations = [];
      const tx = {
        get: async (reference) => snapshot(reference.path),
        create: (reference, data) => operations.push(() => {
          if (docs.has(reference.path)) throw new Error("already exists");
          docs.set(reference.path, { ...data });
        }),
        update: (reference, changes) => operations.push(() => {
          if (!docs.has(reference.path)) throw new Error("not found");
          docs.set(reference.path, { ...docs.get(reference.path), ...changes });
        }),
        delete: (reference) => operations.push(() => docs.delete(reference.path)),
      };
      const result = await callback(tx);
      operations.forEach((operation) => operation());
      return result;
    },
  };
  const seed = (collection, id, data) => docs.set(`${collection}/${id}`, data);
  return { db, seed, docs, calls };
}

function fixture() {
  const store = fakeFirestore();
  for (const uid of ["alice", "bob", "carol", "dave", "eric"]) {
    store.seed("users", uid, { uid, username: uid, status: "active" });
  }
  const repository = new FriendshipRepository({
    db: store.db,
    admin: { firestore: { FieldValue: { serverTimestamp: () => "test-timestamp" } } },
  });
  return { ...store, repository };
}

function ranking(points, rankedSessions = 1, elo = 1000) {
  return { points, rankedSessions, averageScore: rankedSessions ? points / rankedSessions : 0, elo };
}

async function friend(repository, requester, recipient) {
  await repository.createRequest(requester, recipient);
  await repository.acceptRequest(requester, recipient, recipient);
}

describe("SCRUM-114 friend-request Firestore model", () => {
  test("composite indexes cover request direction and accepted friendship query", () => {
    const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../../firestore.indexes.json"), "utf8"));
    const indexes = config.indexes.filter((item) => item.collectionGroup === "friendRelationships");
    assert.deepEqual(indexes.map((item) => item.fields.map((field) =>
      `${field.fieldPath}:${field.order || field.arrayConfig}`)).sort(), [
      ["participants:CONTAINS", "status:ASCENDING"],
      ["recipientUid:ASCENDING", "status:ASCENDING"],
      ["requesterUid:ASCENDING", "status:ASCENDING"],
    ].map((entry) => entry.join(",")).sort().map((entry) => entry.split(",")));
  });

  test("creates one canonical pending record with requester, recipient and timestamps", async () => {
    const f = fixture();
    const result = await f.repository.createRequest("alice", "bob");
    assert.deepEqual(result.participants, ["alice", "bob"]);
    assert.equal(result.status, "pending");
    assert.equal(result.requesterUid, "alice");
    assert.equal(result.recipientUid, "bob");
    assert.equal(result.respondedAt, null);
    assert.equal(f.docs.size, 6);
    assert.deepEqual(await f.repository.findRelationship("bob", "alice"), result);
    assert.equal(f.repository.relationshipRef("bob", "alice").id, result.id);
  });

  test("same sender is idempotent, opposite direction cannot create a duplicate", async () => {
    const f = fixture();
    const first = await f.repository.createRequest("alice", "bob");
    assert.deepEqual(await f.repository.createRequest("alice", "bob"), first);
    await assert.rejects(f.repository.createRequest("bob", "alice"), { code: "friend-request-pending" });
    assert.equal([...f.docs.keys()].filter((key) => key.startsWith("friendRelationships/")).length, 1);
  });

  test("rejects self requests, malformed IDs and nonexistent/deleting users", async () => {
    const f = fixture();
    await assert.rejects(f.repository.createRequest("alice", "alice"), { code: "self-friend-request" });
    await assert.rejects(f.repository.createRequest("alice", "bad/id"), { code: "invalid-friend-uid" });
    await assert.rejects(f.repository.createRequest("alice", "missing"), { code: "friend-user-not-found" });
    f.seed("users", "bob", { status: "deleting" });
    await assert.rejects(f.repository.createRequest("alice", "bob"), { code: "friend-user-unavailable" });
  });

  test("incoming and outgoing queries only return their matching directions/states", async () => {
    const f = fixture();
    await f.repository.createRequest("alice", "bob");
    await f.repository.createRequest("carol", "bob");
    await f.repository.createRequest("bob", "dave");
    await f.repository.declineRequest("carol", "bob", "bob");
    assert.deepEqual((await f.repository.listIncomingRequests("bob")).map((r) => r.requesterUid), ["alice"]);
    assert.deepEqual((await f.repository.listOutgoingRequests("bob")).map((r) => r.recipientUid), ["dave"]);
    assert.deepEqual((await f.repository.listIncomingRequests("bob", "declined")).map((r) => r.requesterUid), ["carol"]);
    await assert.rejects(f.repository.listIncomingRequests("bob", "unknown"), { code: "invalid-friend-status" });
  });
});

describe("SCRUM-115 confirmed friendship storage and querying", () => {
  test("only the recipient can accept; both users then see the one friendship", async () => {
    const f = fixture();
    await f.repository.createRequest("alice", "bob");
    await assert.rejects(f.repository.acceptRequest("alice", "bob", "alice"), { code: "friend-request-forbidden" });
    const accepted = await f.repository.acceptRequest("alice", "bob", "bob");
    assert.equal(accepted.status, "accepted");
    assert.equal(accepted.acceptedAt, "test-timestamp");
    assert.deepEqual(await f.repository.acceptRequest("alice", "bob", "bob"), accepted);
    assert.equal((await f.repository.listFriends("alice"))[0].friendUid, "bob");
    assert.equal((await f.repository.listFriends("bob"))[0].friendUid, "alice");
    assert.deepEqual(await f.repository.listFriends("carol"), []);
  });

  test("declined requests are not friendships and cannot silently be re-opened", async () => {
    const f = fixture();
    await f.repository.createRequest("alice", "bob");
    const declined = await f.repository.declineRequest("alice", "bob", "bob");
    assert.equal(declined.status, "declined");
    assert.deepEqual(await f.repository.declineRequest("alice", "bob", "bob"), declined);
    assert.deepEqual(await f.repository.listFriends("alice"), []);
    await assert.rejects(f.repository.createRequest("alice", "bob"), { code: "friend-request-declined" });
    await assert.rejects(f.repository.acceptRequest("alice", "bob", "bob"), { code: "friend-request-finalized" });
  });

  test("accepted friendship removal is symmetric and idempotent", async () => {
    const f = fixture();
    await friend(f.repository, "alice", "bob");
    assert.equal(await f.repository.removeFriendship("bob", "alice"), true);
    assert.equal(await f.repository.removeFriendship("alice", "bob"), false);
    assert.deepEqual(await f.repository.listFriends("bob"), []);
    assert.equal(await f.repository.findRelationship("alice", "bob"), null);
  });

  test("invalid state transitions and corrupted documents fail closed", async () => {
    const f = fixture();
    await f.repository.createRequest("alice", "bob");
    await assert.rejects(f.repository.removeFriendship("alice", "bob"), { code: "friendship-not-accepted" });
    await friend(f.repository, "carol", "dave");
    await assert.rejects(f.repository.declineRequest("carol", "dave", "dave"), { code: "friend-request-finalized" });
    const key = f.repository.relationshipRef("carol", "dave").path;
    f.docs.get(key).participants = ["carol", "intruder"];
    await assert.rejects(f.repository.listFriends("carol"), { code: "friendship-data-invalid" });
  });
});

describe("SCRUM-116 friends-only ranking query", () => {
  test("no friends returns empty without querying user profiles", async () => {
    const f = fixture();
    assert.deepEqual(await f.repository.listFriendsLeaderboard("alice"), []);
    assert.equal(f.calls.getAll.length, 0);
  });

  test("reads accepted friends only, sorts by ELO and excludes private fields", async () => {
    const f = fixture();
    await friend(f.repository, "alice", "bob");
    await friend(f.repository, "carol", "alice");
    await f.repository.createRequest("alice", "dave");
    f.seed("users", "bob", { username: "Bob", ranking: ranking(90, 1, 1234), email: "secret@example.com" });
    f.seed("users", "carol", { username: "Carol", ranking: ranking(150, 2, 1500), email: "also-private" });
    f.seed("users", "dave", { username: "Dave", ranking: ranking(100, 1, 2400) });
    const result = await f.repository.listFriendsLeaderboard("alice");
    assert.deepEqual(result.map((row) => row.uid), ["carol", "bob"]);
    assert.deepEqual(result.map((row) => row.rank), [1, 2]);
    assert.deepEqual(result.map((row) => row.elo), [1500, 1234]);
    assert.ok(result.every((row) => !Object.hasOwn(row, "points")));
    assert.ok(result.every((row) => !Object.hasOwn(row, "email")));
    assert.deepEqual(f.calls.getAll[0].ids.sort(), ["bob", "carol"]);
    assert.deepEqual(f.calls.getAll[0].options.fieldMask, ["username", "ranking", "deleting", "status"]);
  });

  test("ties share competition rank; missing, deleted and unranked users are excluded", async () => {
    const f = fixture();
    await friend(f.repository, "alice", "bob");
    await friend(f.repository, "alice", "carol");
    await friend(f.repository, "alice", "dave");
    await friend(f.repository, "alice", "eric");
    f.seed("users", "bob", { username: "Bob", ranking: ranking(80) });
    f.seed("users", "carol", { username: "Carol", ranking: ranking(80) });
    f.seed("users", "dave", { username: "Dave", ranking: ranking(50), deleting: true });
    f.seed("users", "eric", { username: "Eric", ranking: ranking(0, 0) });
    assert.deepEqual((await f.repository.listFriendsLeaderboard("alice")).map((r) => [r.uid, r.rank]),
      [["bob", 1], ["carol", 1]]);
    f.docs.delete("users/carol");
    assert.deepEqual((await f.repository.listFriendsLeaderboard("alice")).map((r) => r.uid), ["bob"]);
  });

  test("large friends lists are fetched in bounded batches instead of scanning users", async () => {
    const f = fixture();
    for (let i = 0; i < 101; i++) {
      const uid = `friend-${i}`;
      f.seed("users", uid, { username: uid, ranking: ranking(50) });
      await friend(f.repository, "alice", uid);
    }
    const result = await f.repository.listFriendsLeaderboard("alice");
    assert.equal(result.length, 101);
    assert.deepEqual(f.calls.getAll.map((entry) => entry.ids.length), [100, 1]);
  });

  test("subsequent reads reflect persisted ranking changes without a global scan", async () => {
    const f = fixture();
    await friend(f.repository, "alice", "bob");
    await friend(f.repository, "alice", "carol");
    f.seed("users", "bob", { username: "Bob", ranking: ranking(40, 1, 1100) });
    f.seed("users", "carol", { username: "Carol", ranking: ranking(70, 1, 1200) });
    assert.deepEqual((await f.repository.listFriendsLeaderboard("alice")).map((r) => r.uid), ["carol", "bob"]);
    f.seed("users", "bob", { username: "Bob", ranking: ranking(99, 1, 1300) });
    assert.deepEqual((await f.repository.listFriendsLeaderboard("alice")).map((r) => r.uid), ["bob", "carol"]);
  });
});
