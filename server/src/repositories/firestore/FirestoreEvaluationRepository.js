
"use strict";

const crypto = require("node:crypto");
const EvaluationRepository = require("../contracts/EvaluationRepository");
const { AI_GRADABLE_MODES } = require("../../services/evaluationContract");
const { USER_ROLES } = require("../../config/roles");
const { AI_PROVIDER_TIMEOUT_MS, AI_UNDISPATCHED_LEASE_MS, AI_REVIEW_DELAY_MS } = require("../../config/evaluationRecovery");
const { getDateKey } = require("../../services/questionQuotaService");
const {
  USER_DAILY_AI_EVALUATION_LIMIT,
  DAILY_AI_EVALUATION_TIME_ZONE,
} = require("../../config/evaluationBudget");
const {
  assertOwnedActiveSession,
  assertAssignedQuestion,
  reject,
} = require("../../services/sessionAssignmentPolicy");

// This cap limits repeated attempts on one question. A separate per-user
// daily budget limits new provider reservations across all sessions.
const MAX_ATTEMPTS_PER_QUESTION = 3;
// This is a response-classification grace period, never an automatic unlock.
const PROVIDER_STATUS_GRACE_MS = 5000;

function answerFingerprint(answer) {
  return crypto.createHash("sha256").update(answer.trim(), "utf8").digest("hex");
}

class FirestoreEvaluationRepository extends EvaluationRepository {
  constructor({
    db,
    admin,
    dailyEvaluationLimit = USER_DAILY_AI_EVALUATION_LIMIT,
    timeZone = DAILY_AI_EVALUATION_TIME_ZONE,
    now = () => new Date(),
    undispatchedLeaseMs = AI_UNDISPATCHED_LEASE_MS,
    reviewDelayMs = AI_REVIEW_DELAY_MS,
  }) {
    super();
    if (!db) {
      throw new Error("FirestoreEvaluationRepository requires a Firestore db instance.");
    }
    this.db = db;
    if (!Number.isSafeInteger(dailyEvaluationLimit) || dailyEvaluationLimit < 1) {
      throw new Error("Daily AI evaluation budget must be a positive integer.");
    }
    // Catch invalid deployment configuration at startup, not during a paid call.
    new Intl.DateTimeFormat("en-US", { timeZone });
    this.admin = admin;
    this.dailyEvaluationLimit = dailyEvaluationLimit;
    this.timeZone = timeZone;
    this.now = now;
    this.undispatchedLeaseMs = undispatchedLeaseMs;
    this.reviewDelayMs = reviewDelayMs;
  }

  getTimestamp(fallbackValue) {
    return this.admin?.firestore?.FieldValue?.serverTimestamp
      ? this.admin.firestore.FieldValue.serverTimestamp()
      : fallbackValue || new Date().toISOString();
  }

  getRefs(sessionId, questionId) {
    const sessionRef = this.db.collection("sessions").doc(sessionId);
    return {
      sessionRef,
      responseRef: sessionRef.collection("responses").doc(questionId),
      attemptRef: sessionRef.collection("evaluationAttempts").doc(questionId),
    };
  }

  getDailyEvaluationUsageRef(userId, dateKey) {
    return this.db.collection("users")
      .doc(userId)
      .collection("evaluationUsage")
      .doc(dateKey);
  }

  assertAuthorized(session, userId, mode, questionId) {
    assertOwnedActiveSession(session, userId);
    if (!AI_GRADABLE_MODES.has(mode) || session.mode !== mode) {
      throw reject("Evaluation mode does not match the session.", 409, "SESSION_MODE_MISMATCH");
    }
    if (session.assignmentStatus !== "assigned") {
      throw reject("This interview has no finalized question assignment.", 409, "ASSIGNMENT_NOT_READY");
    }
    assertAssignedQuestion(session, questionId);
  }

  // SEC-04: claim the question before paying the provider. The attempt document
  // is keyed by question ID, not by a caller-controlled request ID.
  async reserveEvaluation({ userId, role = USER_ROLES.USER, sessionId, questionId, mode, candidateResponse, requestId = null }) {
    if (!userId || !sessionId || !questionId || !candidateResponse?.trim()) {
      throw reject("Valid evaluation identifiers and answer are required.", 400, "EVALUATION_IDENTIFIERS_REQUIRED");
    }

    const { sessionRef, responseRef, attemptRef } = this.getRefs(sessionId, questionId);
    const fingerprint = answerFingerprint(candidateResponse);
    const reservedAtMs = this.now().getTime();
    const isAdmin = role === USER_ROLES.ADMIN;
    // Freeze the date for this reservation, including Firestore transaction retries.
    const dateKey = getDateKey(this.now(), this.timeZone);
    const usageRef = isAdmin ? null : this.getDailyEvaluationUsageRef(userId, dateKey);

    return this.db.runTransaction(async (tx) => {
      // Firestore requires all reads before writes.
      const sessionSnap = await tx.get(sessionRef);
      const responseSnap = await tx.get(responseRef);
      const attemptSnap = await tx.get(attemptRef);
      // Read the shared daily counter in the same transaction as the question lock.
      // The shared document causes concurrent requests across different sessions
      // for one user to conflict and retry safely under Firestore transactions.
      const usageSnap = usageRef ? await tx.get(usageRef) : null;
      const session = sessionSnap.exists ? sessionSnap.data() : null;
      this.assertAuthorized(session, userId, mode, questionId);

      // Replaying the same *already saved* answer is safe and costs no AI call.
      if (responseSnap.exists) {
        const saved = responseSnap.data();
        if (
          saved?.mode === mode &&
          typeof saved.candidateResponse === "string" &&
          answerFingerprint(saved.candidateResponse) === fingerprint &&
          saved.evaluation
        ) {
          return { kind: "replay", evaluation: saved.evaluation };
        }
        throw reject("This question has already been answered.", 409, "QUESTION_ALREADY_ANSWERED");
      }

      const previous = attemptSnap.exists ? attemptSnap.data() : null;
      if (previous?.state === "processing") {
        // A reservation with no dispatch marker cannot have called the provider
        // through the SEC-04 route. Reclaim only after its bounded lease.
        // Missing timestamps from older deployments fail closed for review.
        const canReclaim = Number.isSafeInteger(previous.reservedAtMs) &&
          reservedAtMs - previous.reservedAtMs >= this.undispatchedLeaseMs;
        if (!canReclaim) {
          throw reject("This question is already being evaluated. Retry shortly.", 409, "EVALUATION_IN_PROGRESS");
        }
      }
      if (previous?.state === "provider_started") {
        // A competing request can arrive after dispatch but before the AI
        // result is persisted. Report that ordinary concurrency as IN_PROGRESS.
        // Once the provider timeout plus a small grace period has elapsed,
        // the outcome may be uncertain and needs review instead.
        // Neither response changes the reservation or consumes more budget.
        const startedAt = previous.providerStartedAtMs;
        const elapsedMs = reservedAtMs - startedAt;
        const stillWithinProviderWindow =
          Number.isSafeInteger(startedAt) &&
          elapsedMs >= 0 &&
          elapsedMs < AI_PROVIDER_TIMEOUT_MS + PROVIDER_STATUS_GRACE_MS;

        if (stillWithinProviderWindow) {
          throw reject(
            "This question is already being evaluated. Retry shortly.",
            409,
            "EVALUATION_IN_PROGRESS"
          );
        }

        // An old dispatched attempt must never automatically be reclaimed.
        throw reject(
          "Evaluation outcome requires review before retrying.",
          409,
          "EVALUATION_REVIEW_REQUIRED"
        );
      }
      if (previous?.state === "review_required") {
        throw reject(
          "Evaluation outcome requires review before retrying.",
          409,
          "EVALUATION_REVIEW_REQUIRED"
        );
      }
      if (previous?.state === "completed") {
        // Fail closed if an attempt reports success but the response is absent.
        throw reject("This evaluation needs reconciliation.", 409, "EVALUATION_RECONCILIATION_REQUIRED");
      }

      const attemptCount = (Number(previous?.attemptCount) || 0) + 1;
      if (attemptCount > MAX_ATTEMPTS_PER_QUESTION) {
        throw reject("Evaluation attempt limit reached for this question.", 429, "EVALUATION_ATTEMPT_LIMIT");
      }

      // Replay, in-progress, completed, and per-question cap checks above do
      // not spend another daily allowance. Only a new provider reservation does.
      let nextUsage = null;
      if (usageRef) {
        const usage = usageSnap.exists ? usageSnap.data() || {} : {};
        const used = usage.attemptsUsed === undefined ? 0 : usage.attemptsUsed;
        if (!Number.isSafeInteger(used) || used < 0) {
          throw reject("Daily AI evaluation budget data is invalid.", 409, "EVALUATION_BUDGET_INVALID");
        }
        if (used >= this.dailyEvaluationLimit) {
          throw reject(
            "Daily AI evaluation budget reached. Try again after the daily reset.",
            429,
            "DAILY_EVALUATION_LIMIT_EXCEEDED"
          );
        }
        const code = usage.codeEvaluationsUsed === undefined ? 0 : usage.codeEvaluationsUsed;
        const theory = usage.theoreticalEvaluationsUsed === undefined ? 0 : usage.theoreticalEvaluationsUsed;
        if (![code, theory].every((value) => Number.isSafeInteger(value) && value >= 0)) {
          throw reject("Daily AI evaluation budget data is invalid.", 409, "EVALUATION_BUDGET_INVALID");
        }
        nextUsage = {
          dateKey,
          timeZone: this.timeZone,
          attemptsUsed: used + 1,
          codeEvaluationsUsed: code + (mode === "Code Style" ? 1 : 0),
          theoreticalEvaluationsUsed: theory + (mode === "Theoretical Style" ? 1 : 0),
          updatedAt: this.getTimestamp(),
        };
      }

      // Preserve a compact audit trail when a reviewed/expired attempt is
      // replaced. The active attempt document itself is overwritten by tx.set.
      const history = Array.isArray(previous?.history) ? previous.history : [];
      const priorSummary = previous ? {
        attemptId: previous.attemptId || null,
        state: previous.state || null,
        reservedAtMs: previous.reservedAtMs || null,
        providerStartedAtMs: previous.providerStartedAtMs || null,
        reviewedBy: previous.reviewedBy || null,
        evidenceReference: previous.evidenceReference || null,
      } : null;

      // Never trust a request ID as the lock; use a server-generated token.
      const attemptId = crypto.randomUUID();
      if (usageRef) {
        tx.set(usageRef, nextUsage);
      }
      tx.set(attemptRef, {
        userId,
        questionId,
        mode,
        state: "processing",
        fingerprint,
        attemptId,
        attemptCount,
        clientRequestId: requestId,
        budgetDateKey: dateKey,
        reservedAtMs,
        history: priorSummary ? [...history, priorSummary].slice(-3) : [],
        updatedAt: this.getTimestamp(),
      });
      return { kind: "reserved", attemptId };
    });
  }

  // This transaction is the provider dispatch gate. A stale processing lock
  // can be reclaimed, but a provider_started lock NEVER can be auto-reclaimed.
  async markProviderStarted({ userId, sessionId, questionId, mode, attemptId }) {
    const { sessionRef, responseRef, attemptRef } = this.getRefs(sessionId, questionId);
    return this.db.runTransaction(async (tx) => {
      const sessionSnap = await tx.get(sessionRef);
      const responseSnap = await tx.get(responseRef);
      const attemptSnap = await tx.get(attemptRef);
      this.assertAuthorized(sessionSnap.exists ? sessionSnap.data() : null, userId, mode, questionId);
      if (responseSnap.exists) {
        throw reject("Question already answered.", 409, "QUESTION_ALREADY_ANSWERED");
      }
      const attempt = attemptSnap.exists ? attemptSnap.data() : null;
      if (attempt?.userId !== userId || attempt?.attemptId !== attemptId ||
          attempt?.state !== "processing" || attempt?.mode !== mode) {
        throw reject("Evaluation reservation is not current.", 409, "EVALUATION_RESERVATION_INVALID");
      }
      tx.update(attemptRef, {
        state: "provider_started",
        providerStartedAtMs: this.now().getTime(),
        updatedAt: this.getTimestamp(),
      });
      return true;
    });
  }

  // Never treat a timeout/connection reset as proof of non-billing.
  // If Firestore itself is unavailable, provider_started still blocks replays.
  async markUncertainEvaluation({ userId, sessionId, questionId, attemptId }) {
    const { attemptRef, responseRef } = this.getRefs(sessionId, questionId);
    return this.db.runTransaction(async (tx) => {
      const responseSnap = await tx.get(responseRef);
      const attemptSnap = await tx.get(attemptRef);
      const attempt = attemptSnap.exists ? attemptSnap.data() : null;
      if (responseSnap.exists || attempt?.userId !== userId ||
          attempt?.attemptId !== attemptId || attempt?.state !== "provider_started") {
        return false;
      }
      tx.update(attemptRef, {
        state: "review_required",
        reviewReason: "provider_outcome_uncertain",
        updatedAt: this.getTimestamp(),
      });
      return true;
    });
  }

  // Explicit operator-only recovery. Call from the local maintenance script,
  // never from an HTTP route. The provider's billing/outcome must be reviewed.
  // Recovery DOES NOT refund the daily budget or overwrite saved grades.
  async reconcileUncertainEvaluation({ sessionId, questionId, evidenceReference, operatorId }) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(sessionId || "")) ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(String(questionId || "")) ||
        typeof operatorId !== "string" || operatorId.trim().length < 3 ||
        typeof evidenceReference !== "string" || evidenceReference.trim().length < 8) {
      throw reject("Valid identifiers, operator ID and evidence reference are required.", 400, "RECONCILIATION_INPUT_INVALID");
    }
    const { sessionRef, responseRef, attemptRef } = this.getRefs(sessionId, questionId);
    return this.db.runTransaction(async (tx) => {
      const sessionSnap = await tx.get(sessionRef);
      const responseSnap = await tx.get(responseRef);
      const attemptSnap = await tx.get(attemptRef);
      const session = sessionSnap.exists ? sessionSnap.data() : null;
      if (!session) throw reject("Session not found.", 404, "SESSION_NOT_FOUND");
      if (session.status !== "active") {
        throw reject("Only active sessions can be retried.", 409, "SESSION_NOT_ACTIVE");
      }
      if (responseSnap.exists) {
        throw reject("A response is already saved; do not reset.", 409, "QUESTION_ALREADY_ANSWERED");
      }
      const attempt = attemptSnap.exists ? attemptSnap.data() : null;
      if (attempt?.userId !== session.userId || attempt?.questionId !== questionId ||
          !Array.isArray(session.assignedQuestionIds) ||
          !session.assignedQuestionIds.includes(questionId)) {
        throw reject("Attempt ownership or question assignment is invalid.", 409, "RECONCILIATION_ASSIGNMENT_INVALID");
      }
      if (!["review_required", "provider_started"].includes(attempt?.state)) {
        throw reject("Attempt is not awaiting review.", 409, "RECONCILIATION_NOT_REQUIRED");
      }
      if (!Number.isSafeInteger(attempt.providerStartedAtMs) ||
          this.now().getTime() - attempt.providerStartedAtMs < this.reviewDelayMs) {
        throw reject("Review hold period has not elapsed.", 409, "RECONCILIATION_TOO_EARLY");
      }
      tx.update(attemptRef, {
        state: "failed",
        reviewReason: "manual_reviewed_retry_authorized",
        reviewedBy: operatorId.trim(),
        evidenceReference: evidenceReference.trim(),
        reviewedAt: this.getTimestamp(),
        updatedAt: this.getTimestamp(),
      });
      return true;
    });
  }

  // SEC-04: commit the grade only when the caller still owns the reservation.
  async completeReservedEvaluation({
    userId, sessionId, questionId, mode, candidateResponse,
    attemptId, questionPrompt, evaluation, evaluatedAt,
  }) {
    if (!attemptId || !userId || !sessionId || !questionId) {
      throw reject("Reservation and evaluation identifiers are required.", 400, "EVALUATION_IDENTIFIERS_REQUIRED");
    }
    const { sessionRef, responseRef, attemptRef } = this.getRefs(sessionId, questionId);
    return this.db.runTransaction(async (tx) => {
      const sessionSnap = await tx.get(sessionRef);
      const responseSnap = await tx.get(responseRef);
      const attemptSnap = await tx.get(attemptRef);
      const session = sessionSnap.exists ? sessionSnap.data() : null;
      this.assertAuthorized(session, userId, mode, questionId);

      if (responseSnap.exists) {
        throw reject("This question has already been answered.", 409, "QUESTION_ALREADY_ANSWERED");
      }
      const attempt = attemptSnap.exists ? attemptSnap.data() : null;
      if (
        attempt?.userId !== userId ||
        attempt?.attemptId !== attemptId ||
        attempt?.state !== "provider_started" ||
        attempt?.mode !== mode ||
        attempt?.fingerprint !== answerFingerprint(candidateResponse)
      ) {
        throw reject("Evaluation reservation is not current.", 409, "EVALUATION_RESERVATION_INVALID");
      }

      const timestamp = this.getTimestamp(evaluatedAt);
      tx.update(sessionRef, { updatedAt: timestamp });
      tx.set(responseRef, {
        questionId, questionPrompt: questionPrompt || null, mode,
        candidateResponse, evaluation, evaluatedAt: timestamp,
      });
      tx.update(attemptRef, { state: "completed", updatedAt: timestamp });
    });
  }

  // Only a provider failure (not an uncertain Firestore commit) releases a
  // reservation. This prevents overwriting an unknown successful grade.
  async failReservedEvaluation({ userId, sessionId, questionId, attemptId }) {
    const { attemptRef } = this.getRefs(sessionId, questionId);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(attemptRef);
      const attempt = snap.exists ? snap.data() : null;
      if (
        attempt?.userId !== userId ||
        attempt?.attemptId !== attemptId ||
        attempt?.state !== "processing"
      ) {
        return false;
      }
      tx.update(attemptRef, { state: "failed", updatedAt: this.getTimestamp() });
      return true;
    });
  }

  // Legacy SEC-03 repository method retained for existing internal callers.
  // New HTTP AI evaluations MUST use the reserve/complete methods above.
  async saveEvaluation({
    userId, sessionId, questionId, questionPrompt, mode,
    candidateResponse, evaluation, evaluatedAt,
  }) {
    if (!userId || !sessionId || !questionId) {
      throw reject("Authenticated user, session ID, and question ID are required.", 400, "EVALUATION_IDENTIFIERS_REQUIRED");
    }
    const { sessionRef, responseRef } = this.getRefs(sessionId, questionId);
    await this.db.runTransaction(async (tx) => {
      const sessionSnap = await tx.get(sessionRef);
      const session = sessionSnap.exists ? sessionSnap.data() : null;
      this.assertAuthorized(session, userId, mode, questionId);
      const prior = await tx.get(responseRef);
      if (prior.exists) {
        throw reject("This question has already been answered.", 409, "QUESTION_ALREADY_ANSWERED");
      }
      const timestamp = this.getTimestamp(evaluatedAt);
      tx.update(sessionRef, { updatedAt: timestamp });
      tx.set(responseRef, {
        questionId, questionPrompt: questionPrompt || null, mode,
        candidateResponse, evaluation, evaluatedAt: timestamp,
      });
    });
  }
}

module.exports = FirestoreEvaluationRepository;
