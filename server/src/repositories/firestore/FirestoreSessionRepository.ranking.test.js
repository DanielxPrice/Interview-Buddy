"use strict";

const FirestoreSessionRepository = require("./FirestoreSessionRepository");

// Deterministic transaction stub. This does not substitute for Firestore
// emulator concurrency tests (reserved for SCRUM-86).
function fixture({ responses = [80], userExists = true, ranking = undefined,
  expired = false } = {}) {
  const docs = new Map();
  const sessionId = "session-a";
  const userId = "user-a";
  const sessionPath = `sessions/${sessionId}`;
  const userPath = `users/${userId}`;
  const now = Date.parse("2026-10-29T19:00:00.000Z");

  docs.set(sessionPath, {
    userId, status: "active", mode: "Quiz Style", questionCount: responses.length || 1,
    assignmentStatus: "assigned", assignedQuestionIds: responses.map((_, i) => `q${i}`),
    ...(expired ? { activeExpiresAtMs: now - 1 } : {}),
  });
  responses.forEach((score, i) => docs.set(`${sessionPath}/responses/q${i}`, {
    questionId: `q${i}`, mode: "Quiz Style", evaluation: { score },
  }));
  if (userExists) docs.set(userPath, { uid: userId, ...(ranking ? { ranking } : {}) });

  const ref = (path) => ({
    path, id: path.split("/").pop(),
    collection: (name) => ref(`${path}/${name}`),
  });
  const db = {
    collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }),
    runTransaction: async (fn) => {
      const writes = [];
      const tx = {
        get: async (reference) => reference.path.endsWith("/responses")
          ? { docs: [...docs.entries()]
            .filter(([path]) => path.startsWith(`${reference.path}/`))
            .map(([path, data]) => ({ id: path.split("/").pop(), data: () => data })) }
          : { exists: docs.has(reference.path), id: reference.id,
            data: () => docs.get(reference.path) },
        update: (reference, data) => writes.push([reference.path, data]),
        delete: (reference) => writes.push([reference.path, null]),
      };
      const result = await fn(tx);
      for (const [path, patch] of writes) {
        if (patch === null) docs.delete(path);
        else if (!docs.has(path)) throw new Error(`Update failed: ${path}`);
        else docs.set(path, { ...docs.get(path), ...patch });
      }
      return result;
    },
  };
  return {
    docs, userPath, sessionPath,
    repository: new FirestoreSessionRepository({ db, now: () => new Date(now) }),
  };
}

describe("SCRUM-84 atomic score-based ranking persistence", () => {
  test("first full interview awards its server-computed score exactly once", async () => {
    const f = fixture({ responses: [90, 70] });
    const result = await f.repository.finalizeSessionWithResults("session-a", "user-a");
    expect(result.result).toMatchObject({ score: 80, rankEligible: true });
    expect(f.docs.get(f.userPath).ranking).toMatchObject({
      points: 80, rankedSessions: 1, averageScore: 80,
    });
    await f.repository.finalizeSessionWithResults("session-a", "user-a");
    expect(f.docs.get(f.userPath).ranking.points).toBe(80);
    expect(f.docs.get(f.userPath).ranking.rankedSessions).toBe(1);
  });

  test("an existing ranking accumulates another eligible completion", async () => {
    const f = fixture({ ranking: { points: 90, rankedSessions: 1, averageScore: 90 }, responses: [50] });
    await f.repository.finalizeSessionWithResults("session-a", "user-a");
    expect(f.docs.get(f.userPath).ranking).toMatchObject({
      points: 140, rankedSessions: 2, averageScore: 70,
    });
  });

  test("partial completion never changes ranking fields", async () => {
    const f = fixture({ responses: [75, 50] });
    f.docs.delete(`${f.sessionPath}/responses/q1`);
    await f.repository.finalizeSessionWithResults("session-a", "user-a");
    expect(f.docs.get(f.userPath).ranking).toBeUndefined();
    expect(f.docs.get(f.sessionPath).rankEligible).toBe(false);
  });

  test("expired completed assignment cannot award ranking points", async () => {
    const f = fixture({ expired: true, responses: [100] });
    await f.repository.finalizeSessionWithResults("session-a", "user-a");
    expect(f.docs.get(f.userPath).ranking).toBeUndefined();
  });

  test("missing user profile refuses completed ranking and leaves session active", async () => {
    const f = fixture({ userExists: false });
    await expect(f.repository.finalizeSessionWithResults("session-a", "user-a"))
      .rejects.toMatchObject({ statusCode: 503 });
    expect(f.docs.get(f.sessionPath).status).toBe("active");
  });

  test("cross-user finalization cannot update either session or ranking", async () => {
    const f = fixture();
    await expect(f.repository.finalizeSessionWithResults("session-a", "attacker"))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(f.docs.get(f.userPath).ranking).toBeUndefined();
    expect(f.docs.get(f.sessionPath).status).toBe("active");
  });

  test("corrupt user ranking state aborts the session transaction", async () => {
    const f = fixture({ ranking: { points: -1, rankedSessions: 1 } });
    await expect(f.repository.finalizeSessionWithResults("session-a", "user-a"))
      .rejects.toMatchObject({ code: "RANKING_DATA_INVALID" });
    expect(f.docs.get(f.sessionPath).status).toBe("active");
  });
});
