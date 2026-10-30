"use strict";

const FirestoreSessionRepository = require("./FirestoreSessionRepository");

// Sequential Firestore transaction double: verifies read/write atomicity and
// lifecycle logic. Live concurrent transaction contention needs emulator tests.
function fixture({ limit = 2, dailyLimit = 30, lifetimeHours = 1 } = {}) {
  let nowMs = Date.parse("2026-10-28T19:00:00Z");
  let serial = 0;
  const docs = new Map();
  docs.set("users/u1", { uid: "u1", ranking: { points: 0, rankedSessions: 0, averageScore: 0 } });
  const ref = (path) => ({
    id: path.split("/").pop(), path,
    collection: (name) => collection(`${path}/${name}`),
  });
  function collection(path) {
    return {
      doc: (id) => ref(`${path}/${id || `session-${++serial}`}`),
      path,
    };
  }
  function snapshot(path) {
    return {
      id: path.split("/").pop(),
      exists: docs.has(path),
      data: () => docs.get(path),
    };
  }
  const db = {
    collection,
    async runTransaction(fn) {
      const staged = [];
      const tx = {
        get: async (obj) => {
          if (obj.path.endsWith("/responses")) {
            return { docs: Array.from(docs.entries())
              .filter(([path]) => path.startsWith(`${obj.path}/`) &&
                path.split("/").length === 4)
              .map(([path, value]) => ({
                id: path.split("/").pop(),
                data: () => value,
              })) };
          }
          return snapshot(obj.path);
        },
        create: (obj, value) => staged.push(["create", obj.path, value]),
        set: (obj, value) => staged.push(["set", obj.path, value]),
        update: (obj, value) => staged.push(["update", obj.path, value]),
        delete: (obj) => staged.push(["delete", obj.path]),
      };
      const output = await fn(tx);
      for (const [op, path, value] of staged) {
        if (op === "delete") docs.delete(path);
        else if (op === "create" && docs.has(path)) throw new Error("Already exists");
        else if (op === "update") docs.set(path, { ...docs.get(path), ...value });
        else docs.set(path, value);
      }
      return output;
    },
  };
  const repository = new FirestoreSessionRepository({
    db,
    now: () => new Date(nowMs),
    activeSessionLimit: limit,
    activeLifetimeHours: lifetimeHours,
    dailySessionLimit: dailyLimit,
    timeZone: "America/Los_Angeles",
  });
  const create = (userId = "u1", overrides = {}) => repository.createSession({
    userId, mode: "Quiz Style", jobRole: "Developer",
    experienceLevel: "Beginner", questionCount: 2, tags: ["arrays"],
    ...overrides,
  });
  const answers = (id, responseItems) => {
    for (const [questionId, score] of responseItems) {
      docs.set(`sessions/${id}/responses/${questionId}`, {
        questionId, mode: "Quiz Style", evaluation: { score },
      });
    }
  };
  const assign = (id) => {
    docs.set(`sessions/${id}`, {
      ...docs.get(`sessions/${id}`),
      assignmentStatus: "assigned",
      assignedQuestionIds: ["q1", "q2"],
    });
  };
  return {
    repository, docs, create, assign, answers,
    advance: (hours) => { nowMs += hours * 60 * 60 * 1000; },
    session: (id) => docs.get(`sessions/${id}`),
    slot: (uid, index) => docs.get(`users/${uid}/activeSessionSlots/slot-${index}`),
    usage: (uid = "u1") => docs.get(`users/${uid}/sessionCreationUsage/2026-10-28`),
  };
}

describe("SEC-05 bounded active session lifecycle", () => {
  test("creates bounded active slots and returns 429 without consuming a daily allowance on overflow", async () => {
    const f = fixture();
    const a = await f.create();
    const b = await f.create();
    expect([a.activeSlotId, b.activeSlotId]).toEqual(["slot-0", "slot-1"]);
    expect(f.slot("u1", 0).sessionId).toBe(a.id);
    expect(f.slot("u1", 1).sessionId).toBe(b.id);
    await expect(f.create()).rejects.toMatchObject({
      statusCode: 429, code: "ACTIVE_SESSION_LIMIT_EXCEEDED",
    });
    expect(f.usage().created).toBe(2);
    expect([...f.docs.keys()].filter((key) => /^sessions\/[^/]+$/.test(key))).toHaveLength(2);
  });

  test("normal completion atomically frees a slot and retains a ranked full result", async () => {
    const f = fixture({ limit: 1 });
    const first = await f.create();
    f.assign(first.id);
    f.answers(first.id, [["q1", 90], ["q2", 100]]);
    const completed = await f.repository.finalizeSessionWithResults(first.id, "u1");
    expect(completed).toMatchObject({
      status: "completed", completionStatus: "completed", rankEligible: true,
      result: { score: 95, questionsAnswered: 2 },
    });
    expect(f.slot("u1", 0)).toBeUndefined();
    const second = await f.create();
    expect(second.activeSlotId).toBe("slot-0");
    expect(f.slot("u1", 0).sessionId).toBe(second.id);
  });

  test("legacy status-only completion also releases the active slot", async () => {
    const f = fixture({ limit: 1 });
    const old = await f.create();
    const done = await f.repository.completeSession(old.id);
    expect(done.status).toBe("completed");
    expect(f.slot("u1", 0)).toBeUndefined();
    await f.create();
    expect(f.usage().created).toBe(2);
  });

  test("finishing an expired interview directly preserves scoring but disables ranking", async () => {
    const f = fixture({ limit: 1 });
    const old = await f.create();
    f.assign(old.id);
    f.answers(old.id, [["q1", 100], ["q2", 100]]);
    f.advance(2);
    const result = await f.repository.finalizeSessionWithResults(old.id, "u1");
    expect(result).toMatchObject({
      status: "completed", completionReason: "lease_expired",
      completionStatus: "completed", rankEligible: false,
      result: { score: 100, rankEligible: false },
    });
    expect(f.slot("u1", 0)).toBeUndefined();
  });

  test("an expired pending interview is archived as abandoned and the slot is reused", async () => {
    const f = fixture({ limit: 1 });
    const old = await f.create();
    f.advance(0.99);
    await expect(f.create()).rejects.toMatchObject({ code: "ACTIVE_SESSION_LIMIT_EXCEEDED" });
    f.advance(0.02);
    const newer = await f.create();
    expect(newer.id).not.toBe(old.id);
    expect(f.session(old.id)).toMatchObject({
      status: "completed", completionStatus: "abandoned",
      completionReason: "lease_expired", rankEligible: false,
      result: { questionsAnswered: 0, questionsUnanswered: 2, score: 0 },
    });
    expect(f.slot("u1", 0).sessionId).toBe(newer.id);
    expect(f.usage().created).toBe(2);
  });

  test("an expired partly-answered interview keeps the genuine grade but cannot rank", async () => {
    const f = fixture({ limit: 1 });
    const old = await f.create();
    f.assign(old.id);
    f.answers(old.id, [["q1", 80]]);
    f.advance(2);
    await f.create();
    expect(f.session(old.id)).toMatchObject({
      status: "completed", completionStatus: "partial", rankEligible: false,
      result: { score: 40, questionsAnswered: 1, rankEligible: false },
    });
  });

  test("even a fully answered but expired session is not passively ranked", async () => {
    const f = fixture({ limit: 1 });
    const old = await f.create();
    f.assign(old.id);
    f.answers(old.id, [["q1", 100], ["q2", 100]]);
    f.advance(2);
    await f.create();
    expect(f.session(old.id)).toMatchObject({
      completionStatus: "completed", rankEligible: false,
      result: { score: 100, rankEligible: false },
    });
  });

  test("a user cannot consume another user's active slots", async () => {
    const f = fixture({ limit: 1 });
    await f.create("u1");
    await f.create("u2");
    await expect(f.create("u1")).rejects.toMatchObject({ code: "ACTIVE_SESSION_LIMIT_EXCEEDED" });
    expect(f.slot("u2", 0).sessionId).toBeTruthy();
  });

  test("old token or foreign session reference cannot free someone else's slot", async () => {
    const f = fixture({ limit: 1 });
    const a = await f.create("u1");
    f.docs.set("sessions/foreign-session", {
      userId: "u2", status: "active", activeSlotId: "slot-0",
    });
    f.docs.set("users/u1/activeSessionSlots/slot-0", {
      sessionId: "foreign-session", expiresAtMs: a.activeExpiresAtMs - 1,
    });
    f.advance(2);
    await expect(f.create("u1")).rejects.toMatchObject({ statusCode: 503 });
    expect(f.session(a.id).status).toBe("active");
  });

  test("legacy sessions without an active slot remain finalizable", async () => {
    const f = fixture();
    f.docs.set("sessions/legacy", {
      userId: "u1", mode: "Quiz Style", status: "active",
      assignmentStatus: "pending", assignedQuestionIds: [], questionCount: 2,
    });
    const completed = await f.repository.finalizeSessionWithResults("legacy", "u1");
    expect(completed).toMatchObject({
      completionStatus: "abandoned", status: "completed", rankEligible: false,
    });
  });

  test("invalid slot or active-limit configuration fails closed", async () => {
    const f = fixture({ limit: 1 });
    await f.create();
    f.docs.set("users/u1/activeSessionSlots/slot-0", { sessionId: "session-1", expiresAtMs: "corrupt" });
    await expect(f.create()).rejects.toMatchObject({ code: "ACTIVE_SESSION_LIMIT_EXCEEDED" });
    expect(() => new FirestoreSessionRepository({ db: f.repository.db, activeSessionLimit: 0 }))
      .toThrow(/Active session limit/i);
    expect(() => new FirestoreSessionRepository({ db: f.repository.db, activeLifetimeHours: 0 }))
      .toThrow(/active session lifetime/i);
  });

  test("daily session creation limit remains binding even after a slot is released", async () => {
    const f = fixture({ limit: 1, dailyLimit: 1 });
    const first = await f.create();
    await f.repository.finalizeSessionWithResults(first.id, "u1");
    expect(f.slot("u1", 0)).toBeUndefined();
    await expect(f.create()).rejects.toMatchObject({ code: "DAILY_SESSION_LIMIT_EXCEEDED" });
  });
});
