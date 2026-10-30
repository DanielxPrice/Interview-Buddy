"use strict";

const FirestoreApiRateLimitRepository = require("./FirestoreApiRateLimitRepository");
const { WINDOW_MS, RETENTION_MS } = require("../../config/apiRateLimits");

function fixture({ limits = { global: 3, questions: 2, evaluations: 1 }, initialMs = 1234567800000 } = {}) {
  const store = new Map();
  let currentMs = initialMs;
  let writesCommitted = 0;
  function ref(path) {
    return {
      path,
      collection(name) {
        return { doc(id) { return ref(`${path}/${name}/${id}`); } };
      },
    };
  }
  const db = {
    collection(name) { return { doc(id) { return ref(`${name}/${id}`); } }; },
    runTransaction: jest.fn(async (fn) => {
      const staged = [];
      const tx = {
        get: async (doc) => ({ exists: store.has(doc.path), data: () => store.get(doc.path) }),
        set: (doc, value) => { staged.push({ path: doc.path, value }); },
      };
      const result = await fn(tx);
      staged.forEach(({ path, value }) => {
        store.set(path, value);
        writesCommitted += 1;
      });
      return result;
    }),
  };
  const makeRepository = () => new FirestoreApiRateLimitRepository({
    db, limits, now: () => currentMs,
  });
  return {
    store, db, makeRepository,
    advance: (ms) => { currentMs += ms; },
    get writesCommitted() { return writesCommitted; },
    doc: (uid, bucket) => {
      const start = Math.floor(currentMs / WINDOW_MS) * WINDOW_MS;
      return store.get(`users/${uid}/apiRateLimits/${bucket}_${start}`);
    },
  };
}

describe("SEC-05 distributed Firestore API rate limits", () => {
  test("allows limit-1 and limit; rejects limit+1 with zero extra writes", async () => {
    const f = fixture();
    const repository = f.makeRepository();
    const options = { userId: "user-A", buckets: ["global", "questions"] };
    expect((await repository.consume(options)).allowed).toBe(true);
    expect((await repository.consume(options)).allowed).toBe(true);
    const writes = f.writesCommitted;
    const denied = await repository.consume(options);
    expect(denied).toMatchObject({ allowed: false, bucket: "questions", limit: 2, remaining: 0 });
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
    expect(denied.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect(f.writesCommitted).toBe(writes);
    expect(f.doc("user-A", "global").count).toBe(2);
    expect(f.doc("user-A", "questions").count).toBe(2);
  });

  test("global limit cannot be bypassed by alternating route buckets", async () => {
    const f = fixture();
    const r = f.makeRepository();
    await r.consume({ userId: "u", buckets: ["global", "questions"] });
    await r.consume({ userId: "u", buckets: ["global", "evaluations"] });
    await r.consume({ userId: "u", buckets: ["global"] });
    const result = await r.consume({ userId: "u", buckets: ["global", "evaluations"] });
    expect(result).toMatchObject({ allowed: false, bucket: "global" });
    expect(f.doc("u", "evaluations").count).toBe(1);
  });

  test("user isolation and shared counters across different repository instances", async () => {
    const f = fixture();
    const r1 = f.makeRepository();
    const r2 = f.makeRepository();
    const options = { userId: "user-A", buckets: ["global", "evaluations"] };
    expect((await r1.consume(options)).allowed).toBe(true);
    expect((await r2.consume(options)).allowed).toBe(false);
    expect((await r2.consume({ ...options, userId: "user-B" })).allowed).toBe(true);
    expect(f.doc("user-A", "evaluations").count).toBe(1);
    expect(f.doc("user-B", "evaluations").count).toBe(1);
  });

  test("new minute starts a new window; TTL field is a Firestore Date", async () => {
    const f = fixture({ initialMs: 1234567800000 });
    const r = f.makeRepository();
    const options = { userId: "u", buckets: ["global", "evaluations"] };
    await r.consume(options);
    const initialDoc = f.doc("u", "global");
    expect(initialDoc.expiresAt).toBeInstanceOf(Date);
    expect(initialDoc.expiresAt.getTime()).toBe(initialDoc.windowStartMs + RETENTION_MS);
    f.advance(WINDOW_MS);
    expect((await r.consume(options)).allowed).toBe(true);
    expect(f.doc("u", "global").count).toBe(1);
    expect(f.store.size).toBe(4);
  });

  test("rejects corrupt counters without writing to any bucket", async () => {
    const f = fixture();
    const r = f.makeRepository();
    await r.consume({ userId: "u", buckets: ["global", "questions"] });
    const original = f.doc("u", "global");
    f.store.set(`users/u/apiRateLimits/global_${original.windowStartMs}`, { ...original, count: -4 });
    const writes = f.writesCommitted;
    await expect(r.consume({ userId: "u", buckets: ["global", "questions"] })).rejects.toThrow(/corrupt/i);
    expect(f.writesCommitted).toBe(writes);
  });

  test("rejects malformed UID and unrecognized or repeated bucket names", async () => {
    const f = fixture();
    const r = f.makeRepository();
    await expect(r.consume({ userId: "bad/uid", buckets: ["global"] })).rejects.toThrow(/UID/);
    await expect(r.consume({ userId: "u", buckets: ["global", "invented"] })).rejects.toThrow(/bucket/);
    await expect(r.consume({ userId: "u", buckets: ["global", "global"] })).rejects.toThrow(/bucket/);
    expect(f.db.runTransaction).not.toHaveBeenCalled();
  });

  test("Firestore failures propagate; requests must fail closed in middleware", async () => {
    const f = fixture();
    f.db.runTransaction.mockRejectedValueOnce(new Error("Firestore unavailable"));
    await expect(f.makeRepository().consume({ userId: "u", buckets: ["global"] }))
      .rejects.toThrow("Firestore unavailable");
    expect(f.store.size).toBe(0);
  });

  test("constructor rejects missing database or invalid limit policy", () => {
    expect(() => new FirestoreApiRateLimitRepository()).toThrow(/db/);
    expect(() => new FirestoreApiRateLimitRepository({ db: fixture().db, limits: { global: 0 } })).toThrow(/positive/);
  });
});
