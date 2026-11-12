"use strict";

const FirestoreSessionRepository = require("./FirestoreSessionRepository");

// Deterministic transaction fixture. Writes commit only if the callback succeeds.
// Firestore emulator concurrency testing remains separate.
function fixture({ ranking, userExists = true, expired = false } = {}) {
  const docs = new Map();
  const userPath = "users/owner";
  const now = Date.parse("2026-11-11T18:00:00.000Z");
  if (userExists) docs.set(userPath, {
    uid: "owner", ...(ranking === undefined ? {} : { ranking }),
  });

  const ref = (path) => ({
    path, id: path.split("/").pop(),
    collection: (name) => ref(`${path}/${name}`),
  });
  const db = {
    collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }),
    runTransaction: async (callback) => {
      const writes = [];
      const transaction = {
        get: async (reference) => reference.path.endsWith("/responses")
          ? { docs: [...docs.entries()]
            .filter(([path]) => path.startsWith(`${reference.path}/`))
            .map(([path, data]) => ({ id: path.split("/").pop(), data: () => data })) }
          : { exists: docs.has(reference.path), id: reference.id,
            data: () => docs.get(reference.path) },
        update: (reference, patch) => writes.push([reference.path, patch]),
        delete: (reference) => writes.push([reference.path, null]),
      };
      const result = await callback(transaction);
      for (const [path, patch] of writes) {
        if (patch !== null && !docs.has(path)) throw new Error(`Cannot update ${path}`);
      }
      for (const [path, patch] of writes) {
        if (patch === null) docs.delete(path);
        else docs.set(path, { ...docs.get(path), ...patch });
      }
      return result;
    },
  };

  function addSession(id, scores, options = {}) {
    const path = `sessions/${id}`;
    docs.set(path, {
      userId: "owner", status: "active", mode: "Quiz Style",
      assignmentStatus: "assigned", questionCount: scores.length,
      assignedQuestionIds: scores.map((_, i) => `q${i}`),
      ...(options.expired || expired ? { activeExpiresAtMs: now - 1 } : {}),
    });
    scores.forEach((score, i) => docs.set(`${path}/responses/q${i}`, {
      questionId: `q${i}`, mode: "Quiz Style", evaluation: { score },
    }));
    return path;
  }

  return { docs, userPath, addSession,
    repository: new FirestoreSessionRepository({ db, now: () => new Date(now) }),
  };
}

describe("SCRUM-112 atomic ELO completion and persistence", () => {
  test("first perfect interview saves +16 ELO on both user and session", async () => {
    const f = fixture();
    const path = f.addSession("one", [100]);
    const completed = await f.repository.finalizeSessionWithResults("one", "owner");
    expect(f.docs.get(f.userPath).ranking).toMatchObject({
      points: 100, rankedSessions: 1, averageScore: 100, elo: 1016,
    });
    expect(f.docs.get(path).result).toMatchObject({
      score: 100, previousElo: 1000, newElo: 1016, eloChange: "+16",
    });
    expect(completed.result.eloChange).toBe("+16");
  });

  test("low-scoring full interview subtracts ELO while awarding points", async () => {
    const f = fixture();
    const path = f.addSession("one", [0]);
    await f.repository.finalizeSessionWithResults("one", "owner");
    expect(f.docs.get(f.userPath).ranking).toMatchObject({
      points: 0, rankedSessions: 1, averageScore: 0, elo: 984,
    });
    expect(f.docs.get(path).result).toMatchObject({
      previousElo: 1000, newElo: 984, eloChange: "-16",
    });
  });

  test("later sessions calculate ELO from the previous saved rating", async () => {
    const f = fixture();
    f.addSession("one", [100]);
    f.addSession("two", [0]);
    await f.repository.finalizeSessionWithResults("one", "owner");
    await f.repository.finalizeSessionWithResults("two", "owner");
    expect(f.docs.get(f.userPath).ranking).toMatchObject({
      points: 100, rankedSessions: 2, averageScore: 50, elo: 999,
    });
    expect(f.docs.get("sessions/two").result).toMatchObject({
      previousElo: 1016, newElo: 999, eloChange: "-17",
    });
  });

  test("an unchanged ELO is recorded as 0", async () => {
    const f = fixture();
    const path = f.addSession("one", [50]);
    await f.repository.finalizeSessionWithResults("one", "owner");
    expect(f.docs.get(path).result.eloChange).toBe("0");
    expect(f.docs.get(f.userPath).ranking.elo).toBe(1000);
  });

  test("preserves unrelated ranking fields from other workstreams", async () => {
    const f = fixture({ ranking: {
      points: 70, rankedSessions: 1, averageScore: 70,
      elo: 1200, skillTier: "senior", customFlag: true,
    } });
    f.addSession("one", [50]);
    await f.repository.finalizeSessionWithResults("one", "owner");
    expect(f.docs.get(f.userPath).ranking).toMatchObject({
      points: 120, rankedSessions: 2, averageScore: 60,
      elo: 1192, skillTier: "senior", customFlag: true,
    });
  });

  test("duplicate completion does not award points or ELO again", async () => {
    const f = fixture();
    f.addSession("one", [100]);
    const first = await f.repository.finalizeSessionWithResults("one", "owner");
    const original = f.docs.get(f.userPath);
    const replay = await f.repository.finalizeSessionWithResults("one", "owner");
    expect(replay.result).toEqual(first.result);
    expect(f.docs.get(f.userPath)).toEqual(original);
  });

  test("partial completion never changes ELO or points", async () => {
    const f = fixture();
    const path = f.addSession("one", [100, 0]);
    f.docs.delete(`${path}/responses/q1`);
    await f.repository.finalizeSessionWithResults("one", "owner");
    expect(f.docs.get(f.userPath).ranking).toBeUndefined();
    expect(f.docs.get(path).result).not.toHaveProperty("eloChange");
  });

  test("expired completion never changes ELO or points", async () => {
    const f = fixture({ expired: true });
    const path = f.addSession("one", [100]);
    await f.repository.finalizeSessionWithResults("one", "owner");
    expect(f.docs.get(f.userPath).ranking).toBeUndefined();
    expect(f.docs.get(path).rankEligible).toBe(false);
    expect(f.docs.get(path).result).not.toHaveProperty("eloChange");
  });

  test("invalid stored ELO aborts both session and ranking updates", async () => {
    const ranking = { points: 80, rankedSessions: 1, averageScore: 80, elo: "999" };
    const f = fixture({ ranking });
    const path = f.addSession("one", [100]);
    await expect(f.repository.finalizeSessionWithResults("one", "owner"))
      .rejects.toMatchObject({ statusCode: 503, code: "RANKING_DATA_INVALID" });
    expect(f.docs.get(path).status).toBe("active");
    expect(f.docs.get(f.userPath).ranking).toEqual(ranking);
  });

  test("corrupt points state aborts the session before awarding ELO", async () => {
    const ranking = { points: -1, rankedSessions: 1, averageScore: 50, elo: 1000 };
    const f = fixture({ ranking });
    const path = f.addSession("one", [100]);
    await expect(f.repository.finalizeSessionWithResults("one", "owner"))
      .rejects.toMatchObject({ code: "RANKING_DATA_INVALID" });
    expect(f.docs.get(path).status).toBe("active");
    expect(f.docs.get(f.userPath).ranking).toEqual(ranking);
  });

  test("missing user profile cannot award ELO or finalize", async () => {
    const f = fixture({ userExists: false });
    const path = f.addSession("one", [100]);
    await expect(f.repository.finalizeSessionWithResults("one", "owner"))
      .rejects.toMatchObject({ statusCode: 503 });
    expect(f.docs.get(path).status).toBe("active");
  });

  test("unauthorized user cannot award ELO on someone else's session", async () => {
    const f = fixture();
    const path = f.addSession("one", [100]);
    await expect(f.repository.finalizeSessionWithResults("one", "attacker"))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(f.docs.get(path).status).toBe("active");
    expect(f.docs.get(f.userPath).ranking).toBeUndefined();
  });
});
