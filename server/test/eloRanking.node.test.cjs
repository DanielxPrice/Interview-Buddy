"use strict";

// Dependency-free regression suite. Runs with Jest (npm test) or Node's test runner:
// node --test test/eloRanking.node.test.cjs
// Jest provides global test; otherwise use Node's built-in test API.
const test = typeof globalThis.test === "function"
  ? globalThis.test
  : require("node:test").test;
const assert = require("node:assert/strict");
const FirestoreSessionRepository = require("../src/repositories/firestore/FirestoreSessionRepository");
const { calculateEloUpdate } = require("../src/services/eloRating");
const { rankProfiles } = require("../src/services/leaderboardRanking");

function fixture(questionScores, experienceLevel = "Intermediate") {
  const docs = new Map();
  const ref = (path) => ({ path, id: path.split("/").at(-1),
    collection: (name) => ref(`${path}/${name}`) });
  const userRef = "users/user-1";
  const sessionRef = "sessions/session-1";
  docs.set(userRef, { uid: "user-1", ranking: {
    points: 0, rankedSessions: 0, averageScore: 0, elo: 1000,
  }});
  docs.set(sessionRef, { userId: "user-1", mode: "Quiz Style", status: "active",
    experienceLevel, questionCount: questionScores.length,
    assignmentStatus: "assigned",
    assignedQuestionIds: questionScores.map((_, i) => `q${i}`),
  });
  questionScores.forEach((score, i) => docs.set(`${sessionRef}/responses/q${i}`, {
    questionId: `q${i}`, mode: "Quiz Style", evaluation: { score },
  }));
  const db = { collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }),
    async runTransaction(callback) {
      const writes = [];
      const transaction = {
        get: async (r) => r.path.endsWith("/responses")
          ? { docs: [...docs.entries()].filter(([path]) => path.startsWith(`${r.path}/`))
            .map(([path, data]) => ({id: path.split("/").at(-1), data: () => data})) }
          : { id: r.id, exists: docs.has(r.path), data: () => docs.get(r.path) },
        update: (r, changes) => writes.push([r.path, changes]),
        delete: (r) => writes.push([r.path, null]),
      };
      const result = await callback(transaction);
      for (const [path, patch] of writes) {
        if (patch === null) docs.delete(path);
        else docs.set(path, { ...docs.get(path), ...patch });
      }
      return result;
    },
  };
  return { docs, userRef, sessionRef,
    repository: new FirestoreSessionRepository({ db, now: () => new Date("2026-11-12T20:00:00Z") }),
  };
}

test("the nine reference difficulty and length examples remain stable", () => {
  const examples = [
    ["Beginner", 1, 100, 0], ["Beginner", 5, 100, 5],
    ["Beginner", 10, 100, 9], ["Beginner", 10, 50, -7],
    ["Intermediate", 10, 50, 0], ["Experienced", 10, 50, 7],
    ["Veteran", 5, 40, 4], ["Veteran", 10, 50, 11],
    ["Veteran", 20, 75, 38],
  ];
  for (const [experienceLevel, questionCount, sessionScore, change] of examples) {
    const result = calculateEloUpdate({currentElo: 1000,
      experienceLevel, questionCount, sessionScore});
    assert.equal(result.eloChange, change, `${experienceLevel} / ${questionCount} / ${sessionScore}`);
  }
});

test("four completed questions are unranked and retain existing ranking", async () => {
  const f = fixture([100, 100, 100, 100], "Veteran");
  const before = { ...f.docs.get(f.userRef).ranking };
  const completed = await f.repository.finalizeSessionWithResults("session-1", "user-1");
  assert.equal(completed.result.completionStatus, "completed");
  assert.equal(completed.result.rankEligible, false);
  assert.equal(completed.result.eloChange, undefined);
  assert.deepEqual(f.docs.get(f.userRef).ranking, before);
});

test("five completed Beginner questions update ELO only once", async () => {
  const f = fixture([100, 100, 100, 100, 100], "Beginner");
  const first = await f.repository.finalizeSessionWithResults("session-1", "user-1");
  assert.equal(first.result.eloChange, "+5");
  assert.equal(f.docs.get(f.userRef).ranking.elo, 1005);
  assert.equal(f.docs.get(f.userRef).ranking.rankedSessions, 1);
  const second = await f.repository.finalizeSessionWithResults("session-1", "user-1");
  assert.deepEqual(first.result, second.result);
  assert.equal(f.docs.get(f.userRef).ranking.elo, 1005);
});

test("ten Veteran questions scoring fifty percent gain eleven ELO", async () => {
  const f = fixture(Array(10).fill(50), "Veteran");
  const saved = await f.repository.finalizeSessionWithResults("session-1", "user-1");
  assert.equal(saved.result.eloChange, "+11");
  assert.equal(f.docs.get(f.userRef).ranking.elo, 1011);
});

test("leaderboard orders by ELO not points and uses competition ties", () => {
  const profile = (uid, elo, points) => ({uid, username: uid,
    ranking: { elo, points, rankedSessions: 1, averageScore: points }});
  const rows = rankProfiles([
    profile("low", 900, 100), profile("high", 1200, 0), profile("tie", 1200, 20),
  ]);
  assert.deepEqual(rows.map(({ uid, rank, elo }) => [uid, rank, elo]), [
    ["high", 1, 1200], ["tie", 1, 1200], ["low", 3, 900],
  ]);
  assert.equal(Object.hasOwn(rows[0], "points"), false);
});
