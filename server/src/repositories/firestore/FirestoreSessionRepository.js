const SessionRepository = require("../contracts/SessionRepository");
const { getDateKey } = require("../../services/questionQuotaService");
const {
  SESSION_DAILY_CREATE_LIMIT,
  SESSION_HISTORY_PAGE_MAX,
  SESSION_STORAGE_TIME_ZONE,
  SESSION_ACTIVE_LIMIT,
  SESSION_ACTIVE_LIFETIME_HOURS,
} = require("../../config/sessionStorageLimits");

const {
  calculateSessionCompletion,
} = require("../../services/sessionCompletionPolicy");

const {
  sameSetup,
  assertOwnedActiveSession,
  assertAssignedQuestion,
  reject,
} = require("../../services/sessionAssignmentPolicy");

const {
  aggregateSessionScore,
  InvalidScoringDataError,
} = require("../../services/sessionScoreAggregator");

function sessionError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeAnswer(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

class FirestoreSessionRepository extends SessionRepository {
  constructor({
    db, admin,
    dailySessionLimit = SESSION_DAILY_CREATE_LIMIT,
    timeZone = SESSION_STORAGE_TIME_ZONE,
    now = () => new Date(),
    activeSessionLimit = SESSION_ACTIVE_LIMIT,
    activeLifetimeHours = SESSION_ACTIVE_LIFETIME_HOURS,
  }) {
    super();

    if (!db) {
      throw new Error(
        "FirestoreSessionRepository requires a Firestore db instance.",
      );
    }

    if (!Number.isSafeInteger(dailySessionLimit) || dailySessionLimit < 1) {
      throw new Error("Daily session limit must be a positive integer.");
    }
    if (!Number.isSafeInteger(activeSessionLimit) || activeSessionLimit < 1 || activeSessionLimit > 10) {
      throw new Error("Active session limit must be an integer between 1 and 10.");
    }
    if (!Number.isSafeInteger(activeLifetimeHours) || activeLifetimeHours < 1 || activeLifetimeHours > 720) {
      throw new Error("Active session lifetime must be an integer between 1 and 720 hours.");
    }
    new Intl.DateTimeFormat("en-US", { timeZone });
    this.db = db;
    this.admin = admin;
    this.dailySessionLimit = dailySessionLimit;
    this.timeZone = timeZone;
    this.now = now;
    this.activeSessionLimit = activeSessionLimit;
    this.activeLifetimeMs = activeLifetimeHours * 60 * 60 * 1000;
    this.sessions = db.collection("sessions");
  }

  getTimestamp() {
    return this.admin?.firestore?.FieldValue?.serverTimestamp
      ? this.admin.firestore.FieldValue.serverTimestamp()
      : new Date().toISOString();
  }

  getActiveSlotRef(userId, slotIndex) {
    return this.db.collection("users").doc(userId)
      .collection("activeSessionSlots").doc(`slot-${slotIndex}`);
  }

  async createSession({
    userId,
    mode,
    jobRole,
    experienceLevel,
    tags = [],
    questionCount = null,
  }) {
    if (!userId || !mode) {
      throw new Error("userId and mode are required.");
    }

    const sessionRef = this.sessions.doc();
    const nowMs = this.now().getTime();
    const expiresAtMs = nowMs + this.activeLifetimeMs;
    const dateKey = getDateKey(new Date(nowMs), this.timeZone);
    const usageRef = this.db.collection("users").doc(userId)
      .collection("sessionCreationUsage").doc(dateKey);
    const slots = Array.from({ length: this.activeSessionLimit }, (_, i) =>
      this.getActiveSlotRef(userId, i));

    let sessionData;
    await this.db.runTransaction(async (transaction) => {
      // Every read must complete before the first transaction write.
      const usageSnap = await transaction.get(usageRef);
      const slotSnaps = [];
      for (const slotRef of slots) {
        slotSnaps.push(await transaction.get(slotRef));
      }

      const prior = usageSnap.exists ? usageSnap.data() : null;
      const used = prior ? prior.created : 0;
      if (!Number.isSafeInteger(used) || used < 0) {
        throw sessionError("Session quota state is invalid.", 503);
      }
      if (used >= this.dailySessionLimit) {
        const error = sessionError("Daily interview session creation limit reached.", 429);
        error.code = "DAILY_SESSION_LIMIT_EXCEEDED";
        throw error;
      }

      let slotIndex = slotSnaps.findIndex((snap) => !snap.exists);
      let oldSessionRef = null;
      let oldSession = null;
      if (slotIndex < 0) {
        slotIndex = slotSnaps.findIndex((snap) => {
          const item = snap.data();
          return Number.isSafeInteger(item?.expiresAtMs) && item.expiresAtMs <= nowMs;
        });
        if (slotIndex >= 0) {
          const old = slotSnaps[slotIndex].data();
          if (typeof old.sessionId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(old.sessionId)) {
            throw sessionError("Active slot state is invalid.", 503);
          }
          oldSessionRef = this.sessions.doc(old.sessionId);
          const oldSnap = await transaction.get(oldSessionRef);
          oldSession = oldSnap.exists ? oldSnap.data() : null;
          if (oldSession && (oldSession.userId !== userId || oldSession.activeSlotId !== `slot-${slotIndex}`)) {
            throw sessionError("Active slot ownership is inconsistent.", 503);
          }
          if (oldSession?.status === "active") {
            // Fetch saved answers before performing any writes. There are at most
            // 20 answers per interview according to SEC-03 questionCount rules.
            const responseSnapshot = await transaction.get(oldSessionRef.collection("responses"));
            const result = { ...calculateSessionCompletion(oldSession, responseSnapshot.docs), rankEligible: false };
            oldSession = { ...oldSession, expiredResult: result };
          }
        }
      }
      if (slotIndex < 0) {
        const error = sessionError("Finish an active interview before starting another.", 429);
        error.code = "ACTIVE_SESSION_LIMIT_EXCEEDED";
        throw error;
      }

      sessionData = {
        userId, mode, jobRole: jobRole || null,
        experienceLevel: experienceLevel || null,
        tags, questionCount,
        assignedQuestionIds: [], assignedQuestions: [],
        assignmentStatus: "pending", status: "active",
        createdAt: this.getTimestamp(), updatedAt: this.getTimestamp(),
        completedAt: null,
        activeSlotId: `slot-${slotIndex}`,
        activeExpiresAtMs: expiresAtMs,
      };

      if (oldSession?.status === "active") {
        transaction.update(oldSessionRef, {
          status: "completed",
          completedAt: this.getTimestamp(), updatedAt: this.getTimestamp(),
          completionStatus: oldSession.expiredResult.completionStatus,
          completionReason: "lease_expired",
          rankEligible: false,
          result: oldSession.expiredResult,
        });
      }
      transaction.set(usageRef, {
        dateKey, timeZone: this.timeZone, created: used + 1,
        expiresAt: new Date(nowMs + 45 * 24 * 60 * 60 * 1000),
        updatedAt: this.getTimestamp(),
      });
      transaction.set(slots[slotIndex], {
        sessionId: sessionRef.id,
        expiresAtMs,
        updatedAt: this.getTimestamp(),
      });
      transaction.create(sessionRef, sessionData);
    });

    return { id: sessionRef.id, ...sessionData };
  }

  /**
   * The first successful assignment wins.
   * Parallel requests cannot replace that assignment.
   */
  async assignQuestions({
    sessionId,
    userId,
    setup,
    questions,
  }) {
    if (
      !sessionId ||
      !userId ||
      !setup ||
      !Array.isArray(questions)
    ) {
      throw reject(
        "A session and question selection are required."
      );
    }

    if (
      questions.length !== setup.questionCount ||
      questions.length < 1 ||
      questions.length > 20
    ) {
      throw reject(
        "The selected question count differs from the session setup.",
        409,
        "QUESTION_COUNT_MISMATCH"
      );
    }

    // Never store private answer or grading fields.
    const publicQuestions = questions.map((question) => ({
      id: question?.id,
      mode: question?.mode,
      prompt: question?.prompt,
      options: Array.isArray(question?.options)
        ? question.options
        : [],
      difficulty: question?.difficulty || "",
      topic: question?.topic || "",
      tags: Array.isArray(question?.tags)
        ? question.tags
        : [],
    }));

    const ids = publicQuestions.map(
      (question) => question.id
    );

    if (
      ids.some(
        (id) =>
          typeof id !== "string" ||
          !id.trim()
      ) ||
      new Set(ids).size !== ids.length ||
      publicQuestions.some(
        (question) =>
          question.mode !== setup.mode ||
          typeof question.prompt !== "string" ||
          !question.prompt.trim()
      )
    ) {
      throw reject(
        "Question assignment contains invalid or duplicate questions.",
        400,
        "INVALID_QUESTION_ASSIGNMENT"
      );
    }

    const sessionRef = this.sessions.doc(sessionId);

    return this.db.runTransaction(async (transaction) => {
      const snapshot =
        await transaction.get(sessionRef);

      const session = snapshot.exists
        ? snapshot.data()
        : null;

      assertOwnedActiveSession(session, userId);

      if (!sameSetup(session, setup)) {
        throw reject(
          "Interview setup differs from the stored session.",
          409,
          "SESSION_SETUP_MISMATCH"
        );
      }

      if (session.assignmentStatus === "assigned") {
        if (
          !Array.isArray(session.assignedQuestions) ||
          !Array.isArray(session.assignedQuestionIds) ||
          session.assignedQuestions.length !==
            session.questionCount
        ) {
          throw reject(
            "Saved question assignment is invalid.",
            409,
            "ASSIGNMENT_CORRUPTED"
          );
        }

        // Return the original assignment unchanged.
        return session.assignedQuestions;
      }

      if (session.assignmentStatus !== "pending") {
        throw reject(
          "This session cannot receive questions.",
          409,
          "SESSION_ASSIGNMENT_UNAVAILABLE"
        );
      }

      transaction.update(sessionRef, {
        assignedQuestionIds: ids,
        assignedQuestions: publicQuestions,
        assignmentStatus: "assigned",
        updatedAt: this.getTimestamp(),
      });

      return publicQuestions;
    });
  }

  async findById(sessionId) {
    if (!sessionId) {
      throw new Error("sessionId is required.");
    }

    const snapshot =
      await this.sessions.doc(sessionId).get();

    return snapshot.exists
      ? {
          id: snapshot.id,
          ...snapshot.data(),
        }
      : null;
  }

  // Legacy array endpoints remain supported, but never load all user sessions.
  // Clients requiring older records should use the explicit paginated API.
  async listByUser(userId) {
    if (!userId) throw new Error("userId is required.");
    const snapshot = await this.sessions.where("userId", "==", userId)
      .orderBy("createdAt", "desc").limit(SESSION_HISTORY_PAGE_MAX).get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  async listCompletedByUser(userId) {
    if (!userId) throw new Error("userId is required.");
    const snapshot = await this.sessions.where("userId", "==", userId)
      .where("status", "==", "completed")
      .orderBy("completedAt", "desc").limit(SESSION_HISTORY_PAGE_MAX).get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  async getSessionPage({ userId, status = null, pageSize = 25, cursor = null }) {
    if (!userId) throw new Error("userId is required.");
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > SESSION_HISTORY_PAGE_MAX) {
      const error = sessionError("Invalid history page size.", 400);
      error.code = "SESSION_PAGE_SIZE_INVALID";
      throw error;
    }
    if (status !== null && status !== "completed") {
      const error = sessionError("Unsupported session status filter.", 400);
      error.code = "SESSION_STATUS_INVALID";
      throw error;
    }

    let query = this.sessions.where("userId", "==", userId);
    if (status === "completed") query = query.where("status", "==", "completed");
    query = query.orderBy(status === "completed" ? "completedAt" : "createdAt", "desc");

    if (cursor) {
      // A cursor is a session document ID, never a client-supplied offset or query.
      const cursorSnap = await this.sessions.doc(cursor).get();
      const cursorData = cursorSnap.exists ? cursorSnap.data() : null;
      if (!cursorData || cursorData.userId !== userId ||
          (status === "completed" && cursorData.status !== "completed")) {
        const error = sessionError("Invalid history cursor.", 400);
        error.code = "SESSION_CURSOR_INVALID";
        throw error;
      }
      query = query.startAfter(cursorSnap);
    }

    // Fetch one extra snapshot solely to determine whether another page exists.
    const snapshot = await query.limit(pageSize + 1).get();
    const docs = snapshot.docs.slice(0, pageSize);
    return {
      sessions: docs.map((doc) => ({ id: doc.id, ...doc.data() })),
      nextCursor: snapshot.docs.length > pageSize ? docs[docs.length - 1].id : null,
    };
  }

  // Legacy compatibility method.
  async completeSession(sessionId) {
    if (!sessionId) {
      throw new Error("sessionId is required.");
    }

    const sessionRef = this.sessions.doc(sessionId);

    return this.db.runTransaction(async (transaction) => {
      const snapshot =
        await transaction.get(sessionRef);

      if (!snapshot.exists) {
        return null;
      }

      const session = snapshot.data();

      if (session.status === "completed") {
        return {
          id: snapshot.id,
          ...session,
        };
      }

      const slotRef = typeof session.activeSlotId === "string" && /^slot-[0-9]+$/.test(session.activeSlotId)
        ? this.db.collection("users").doc(session.userId)
            .collection("activeSessionSlots").doc(session.activeSlotId)
        : null;
      const slotSnap = slotRef ? await transaction.get(slotRef) : null;
      if (slotSnap?.exists && slotSnap.data().sessionId === sessionId) {
        transaction.delete(slotRef);
      }
      transaction.update(sessionRef, {
        status: "completed",
        completedAt: this.getTimestamp(),
        updatedAt: this.getTimestamp(),
      });

      return {
        id: snapshot.id,
        ...session,
        status: "completed",
      };
    });
  }

  // Read saved graded answers for the results breakdown.
  async listResponses(sessionId) {
    if (!sessionId) {
      throw new Error("sessionId is required.");
    }

    const snapshot = await this.sessions
      .doc(sessionId)
      .collection("responses")
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
  }

  // SCRUM-82: Persist server-graded Quiz responses.
  async saveQuizAnswer({
    sessionId,
    userId,
    question,
    answer,
  }) {
    if (
      !sessionId ||
      !userId ||
      !question?.id ||
      typeof answer !== "string"
    ) {
      throw sessionError(
        "Session, user, question and answer are required.",
        400
      );
    }

    if (
      question.mode !== "Quiz Style" ||
      question.active === false
    ) {
      throw sessionError(
        "This is not an available Quiz question.",
        400
      );
    }

    const selectedAnswer = answer.trim();

    if (
      !selectedAnswer ||
      selectedAnswer.length > 1000
    ) {
      throw sessionError(
        "A valid Quiz answer is required.",
        400
      );
    }

    if (
      Array.isArray(question.options) &&
      question.options.length > 0 &&
      !question.options.some(
        (option) =>
          normalizeAnswer(option) ===
          normalizeAnswer(selectedAnswer)
      )
    ) {
      throw sessionError(
        "Answer must match a provided Quiz option.",
        400
      );
    }

    const correctAnswer =
      normalizeAnswer(question.correctAnswer);

    if (!correctAnswer) {
      throw sessionError(
        "Quiz question has no configured answer.",
        500
      );
    }

    const sessionRef = this.sessions.doc(sessionId);
    const responseRef = sessionRef
      .collection("responses")
      .doc(question.id);

    return this.db.runTransaction(async (transaction) => {
      const sessionSnapshot =
        await transaction.get(sessionRef);

      if (!sessionSnapshot.exists) {
        throw sessionError(
          "Session not found.",
          404
        );
      }

      const session = sessionSnapshot.data();

      if (session.userId !== userId) {
        throw sessionError(
          "You do not have access to this session.",
          403
        );
      }

      if (session.mode !== "Quiz Style") {
        throw sessionError(
          "Question mode does not match the session.",
          400
        );
      }

      
      if (session.status !== "active") {
        throw sessionError("This session has already been completed.", 409);
      }
      if (Number.isSafeInteger(session.activeExpiresAtMs) &&
          session.activeExpiresAtMs <= Date.now()) {
        throw reject("This interview has expired. Start a new interview.", 409, "SESSION_EXPIRED");
      }

      // Enforce the assignment inside the Firestore transaction.
      // The earlier HTTP route check alone cannot protect
      // against concurrent changes to the session.
      if (session.assignmentStatus !== "assigned") {
        throw reject(
          "This interview has no finalized question assignment.",
          409,
          "ASSIGNMENT_NOT_READY"
        );
      }

      assertAssignedQuestion(session, question.id);

      const existing = await transaction.get(responseRef);


      if (existing.exists) {
        throw sessionError(
          "This question has already been answered.",
          409
        );
      }

      const isCorrect =
        normalizeAnswer(selectedAnswer) ===
        correctAnswer;

      const explanation =
        question.explanation ||
        (isCorrect
          ? "Correct."
          : "That answer is not correct. Review the topic and try another question.");

      const timestamp = this.getTimestamp();

      transaction.set(responseRef, {
        questionId: question.id,
        questionPrompt: question.prompt || "",
        mode: "Quiz Style",
        candidateResponse: selectedAnswer,
        evaluation: {
          score: isCorrect ? 100 : 0,
          isCorrect,
          feedback: explanation,
        },
        evaluatedAt: timestamp,
      });

      transaction.update(sessionRef, {
        updatedAt: timestamp,
      });

      return {
        questionId: question.id,
        isCorrect,
        explanation,
      };
    });
  }

  
  // SCRUM-82 + SEC-03:
  // Calculate and persist authoritative results.
  async finalizeSessionWithResults(
    sessionId,
    userId
  ) {
    if (!sessionId || !userId) {
      throw sessionError(
        "Session ID and authenticated user are required.",
        400
      );
    }

    const sessionRef =
      this.sessions.doc(sessionId);

    const responsesQuery =
      sessionRef.collection("responses");

    return this.db.runTransaction(
      async (transaction) => {
        const sessionSnapshot =
          await transaction.get(sessionRef);

        if (!sessionSnapshot.exists) {
          throw sessionError(
            "Session not found.",
            404
          );
        }

        const session =
          sessionSnapshot.data();

        if (session.userId !== userId) {
          throw sessionError(
            "You do not have access to this session.",
            403
          );
        }

        // Repeated completion cannot
        // recalculate or change saved results.
        if (session.status === "completed") {
          return {
            id: sessionSnapshot.id,
            ...session,
          };
        }

        if (session.status !== "active") {
          throw sessionError(
            "This session cannot be completed.",
            409
          );
        }

        // Verify the slot still belongs to this session before releasing it.
        // Old sessions without a slot continue to work unchanged.
        const slotRef = typeof session.activeSlotId === "string" &&
          /^slot-[0-9]+$/.test(session.activeSlotId)
          ? this.db.collection("users").doc(userId)
              .collection("activeSessionSlots").doc(session.activeSlotId)
          : null;
        const slotSnap = slotRef ? await transaction.get(slotRef) : null;

        // Read graded responses in the same transaction as session status.
        const responseSnapshot = await transaction.get(responsesQuery);

        // SEC-03:
        // Validate against the frozen assignment
        // and use its question count.
        const result = calculateSessionCompletion(session, responseSnapshot.docs);
        const expired = Number.isSafeInteger(session.activeExpiresAtMs) &&
          session.activeExpiresAtMs <= this.now().getTime();
        if (expired) result.rankEligible = false;

        const timestamp =
          this.getTimestamp();

        if (slotSnap?.exists && slotSnap.data().sessionId === sessionId) {
          transaction.delete(slotRef);
        }
        transaction.update(
          sessionRef,
          {
            status: "completed",
            completedAt: timestamp,
            updatedAt: timestamp,
            result,

            // Make outcome discoverable
            // without opening result fields.
            completionStatus:
              result.completionStatus,

            rankEligible: result.rankEligible,
            ...(expired ? { completionReason: "lease_expired" } : {}),
          }
        );

        return {
          id: sessionSnapshot.id,
          ...session,
          status: "completed",
          completionStatus:
            result.completionStatus,
          rankEligible: result.rankEligible,
          ...(expired ? { completionReason: "lease_expired" } : {}),
          result,
        };
      }
    );
  }
}

module.exports = FirestoreSessionRepository;
