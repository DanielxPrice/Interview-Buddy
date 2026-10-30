
"use strict";

const FirestoreEvaluationRepository = require("./FirestoreEvaluationRepository");
const { AI_PROVIDER_TIMEOUT_MS } = require("../../config/evaluationRecovery");

function fixture() {
  let timeMs = Date.parse("2026-10-27T18:00:00Z");
  const store = new Map();
  const sessionId = "session-test";
  const questionId = "question-test";
  const session = {
    userId: "user-1", status: "active", mode: "Code Style",
    assignmentStatus: "assigned", assignedQuestionIds: [questionId],
  };
  store.set(`sessions/${sessionId}`, session);
  function ref(path) {
    return {
      path, collection(name) {
        return { doc(id) { return ref(`${path}/${name}/${id}`); } };
      },
    };
  }
  const db = {
    collection(name) { return { doc(id) { return ref(`${name}/${id}`); } }; },
    async runTransaction(fn) {
      const writes = [];
      const tx = {
        get: async (r) => ({ exists: store.has(r.path), data: () => store.get(r.path) }),
        set: (r, value) => writes.push(["set", r.path, value]),
        update: (r, value) => writes.push(["update", r.path, value]),
      };
      const result = await fn(tx);
      for (const [kind, path, value] of writes) {
        store.set(path, kind === "set" ? value : { ...store.get(path), ...value });
      }
      return result;
    },
  };
  const repo = new FirestoreEvaluationRepository({
    db, now: () => new Date(timeMs), dailyEvaluationLimit: 20,
    undispatchedLeaseMs: 120000, reviewDelayMs: 300000,
  });
  const input = {
    userId: "user-1", sessionId, questionId,
    mode: "Code Style", candidateResponse: "answer",
  };
  return {
    repo, input, store, session,
    attempt: () => store.get(`sessions/${sessionId}/evaluationAttempts/${questionId}`),
    advance: (ms) => { timeMs += ms; },
  };
}

describe("SEC-04 provider uncertainty and bounded reservation recovery", () => {
  test("dispatch marker is required before grade persistence", async () => {
    const f = fixture();
    const reserved = await f.repo.reserveEvaluation(f.input);
    await expect(f.repo.completeReservedEvaluation({
      ...f.input, attemptId: reserved.attemptId, evaluation: { score: 90 },
    })).rejects.toMatchObject({ code: "EVALUATION_RESERVATION_INVALID" });
    await f.repo.markProviderStarted({ ...f.input, attemptId: reserved.attemptId });
    await f.repo.completeReservedEvaluation({
      ...f.input, attemptId: reserved.attemptId, evaluation: { score: 90 },
    });
    expect(f.attempt().state).toBe("completed");
  });

  test("only an undispatched stale reservation can be automatically reclaimed", async () => {
    const f = fixture();
    const first = await f.repo.reserveEvaluation(f.input);
    f.advance(119999);
    await expect(f.repo.reserveEvaluation(f.input))
      .rejects.toMatchObject({ code: "EVALUATION_IN_PROGRESS" });
    f.advance(2);
    const replacement = await f.repo.reserveEvaluation(f.input);
    expect(replacement.attemptId).not.toBe(first.attemptId);
    await expect(f.repo.markProviderStarted({ ...f.input, attemptId: first.attemptId }))
      .rejects.toMatchObject({ code: "EVALUATION_RESERVATION_INVALID" });
    expect(f.attempt().attemptCount).toBe(2);
  });

  test("fresh provider dispatch is in progress, but old uncertain dispatch requires review", async () => {
    const f = fixture();
    const claim = await f.repo.reserveEvaluation(f.input);
    await f.repo.markProviderStarted({ ...f.input, attemptId: claim.attemptId });

    // Simulate a competing HTTP request while the provider is still running.
    await expect(f.repo.reserveEvaluation({ ...f.input, requestId: "competing" }))
      .rejects.toMatchObject({ statusCode: 409, code: "EVALUATION_IN_PROGRESS" });

    f.advance(AI_PROVIDER_TIMEOUT_MS - 1);
    await expect(f.repo.reserveEvaluation({ ...f.input, requestId: "competing" }))
      .rejects.toMatchObject({ code: "EVALUATION_IN_PROGRESS" });

    // The configured provider timeout plus 5 sec of grace has elapsed.
    f.advance(5002);
    await expect(f.repo.reserveEvaluation({ ...f.input, requestId: "competing" }))
      .rejects.toMatchObject({ code: "EVALUATION_REVIEW_REQUIRED" });

    expect(f.attempt().state).toBe("provider_started");
    expect(f.attempt().attemptId).toBe(claim.attemptId);
    expect(f.attempt().attemptCount).toBe(1);
    expect(f.store.get("users/user-1/evaluationUsage/2026-10-27").attemptsUsed).toBe(1);
  });

  test("provider-started reservation cannot be automatically reclaimed", async () => {
    const f = fixture();
    const claim = await f.repo.reserveEvaluation(f.input);
    await f.repo.markProviderStarted({ ...f.input, attemptId: claim.attemptId });
    f.advance(86400000);
    await expect(f.repo.reserveEvaluation(f.input))
      .rejects.toMatchObject({ code: "EVALUATION_REVIEW_REQUIRED" });
    expect(f.attempt().state).toBe("provider_started");
  });

  test("provider timeout marks review and blocks duplicate paid calls", async () => {
    const f = fixture();
    const claim = await f.repo.reserveEvaluation(f.input);
    await f.repo.markProviderStarted({ ...f.input, attemptId: claim.attemptId });
    expect(await f.repo.markUncertainEvaluation({ ...f.input, attemptId: claim.attemptId }))
      .toBe(true);
    expect(f.attempt().state).toBe("review_required");
    await expect(f.repo.reserveEvaluation(f.input))
      .rejects.toMatchObject({ code: "EVALUATION_REVIEW_REQUIRED" });
  });

  test("operator recovery requires delay and audit evidence and never refunds budget", async () => {
    const f = fixture();
    const claim = await f.repo.reserveEvaluation(f.input);
    await f.repo.markProviderStarted({ ...f.input, attemptId: claim.attemptId });
    await f.repo.markUncertainEvaluation({ ...f.input, attemptId: claim.attemptId });
    const options = {
      sessionId: f.input.sessionId, questionId: f.input.questionId,
      evidenceReference: "INCIDENT-SEC04-100", operatorId: "qa-operator",
    };
    await expect(f.repo.reconcileUncertainEvaluation(options))
      .rejects.toMatchObject({ code: "RECONCILIATION_TOO_EARLY" });
    f.advance(300001);
    await expect(f.repo.reconcileUncertainEvaluation({ ...options, evidenceReference: "" }))
      .rejects.toMatchObject({ code: "RECONCILIATION_INPUT_INVALID" });
    expect(await f.repo.reconcileUncertainEvaluation(options)).toBe(true);
    expect(f.attempt()).toMatchObject({
      state: "failed", reviewedBy: "qa-operator", evidenceReference: "INCIDENT-SEC04-100",
    });
    const replacement = await f.repo.reserveEvaluation(f.input);
    expect(replacement.kind).toBe("reserved");
    expect(f.attempt().history[0]).toMatchObject({
      reviewedBy: "qa-operator", evidenceReference: "INCIDENT-SEC04-100",
    });
    expect(f.store.get("users/user-1/evaluationUsage/2026-10-27").attemptsUsed).toBe(2);
  });

  test("operator recovery refuses to overwrite an existing response or closed session", async () => {
    const f = fixture();
    const claim = await f.repo.reserveEvaluation(f.input);
    await f.repo.markProviderStarted({ ...f.input, attemptId: claim.attemptId });
    f.advance(300001);
    const options = {
      sessionId: f.input.sessionId, questionId: f.input.questionId,
      evidenceReference: "INCIDENT-SEC04-101", operatorId: "qa-operator",
    };
    f.store.set(`sessions/${f.input.sessionId}/responses/${f.input.questionId}`, { evaluation: { score: 85 } });
    await expect(f.repo.reconcileUncertainEvaluation(options))
      .rejects.toMatchObject({ code: "QUESTION_ALREADY_ANSWERED" });
    f.store.delete(`sessions/${f.input.sessionId}/responses/${f.input.questionId}`);
    f.session.status = "completed";
    await expect(f.repo.reconcileUncertainEvaluation(options))
      .rejects.toMatchObject({ code: "SESSION_NOT_ACTIVE" });
  });
});
