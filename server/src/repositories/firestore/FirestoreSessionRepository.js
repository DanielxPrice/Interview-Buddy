const SessionRepository = require("../contracts/SessionRepository");

const {
  calculateSessionCompletion,
} = require("../../services/sessionCompletionPolicy");

const {
  sameSetup,
  assertOwnedActiveSession,
  assertAssignedQuestion,
  reject,
} = require("../../services/sessionAssignmentPolicy");

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
  constructor({ db, admin }) {
    super();

    if (!db) {
      throw new Error(
        "FirestoreSessionRepository requires a Firestore db instance.",
      );
    }

    this.db = db;
    this.admin = admin;
    this.sessions = db.collection("sessions");
  }

  getTimestamp() {
    return this.admin?.firestore?.FieldValue?.serverTimestamp
      ? this.admin.firestore.FieldValue.serverTimestamp()
      : new Date().toISOString();
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

    const sessionData = {
      userId,
      mode,
      jobRole: jobRole || null,
      experienceLevel: experienceLevel || null,
      tags,
      questionCount,
      assignedQuestionIds: [],
      assignedQuestions: [],
      assignmentStatus: "pending",
      status: "active",
      createdAt: this.getTimestamp(),
      updatedAt: this.getTimestamp(),
      completedAt: null,
    };

    const sessionRef = await this.sessions.add(sessionData);

    return {
      id: sessionRef.id,
      ...sessionData,
    };
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

  async listByUser(userId) {
    if (!userId) {
      throw new Error("userId is required.");
    }

    const snapshot = await this.sessions
      .where("userId", "==", userId)
      .orderBy("createdAt", "desc")
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
  }

  // SCRUM-81: Completed-session queries.
  async listCompletedByUser(userId) {
    if (!userId) {
      throw new Error("userId is required.");
    }

    const snapshot = await this.sessions
      .where("userId", "==", userId)
      .where("status", "==", "completed")
      .orderBy("completedAt", "desc")
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
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
        throw sessionError(
          "This session has already been completed.",
          409
        );
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

        // Read graded responses in the
        // same transaction as session status.
        const responseSnapshot =
          await transaction.get(
            responsesQuery
          );

        // SEC-03:
        // Validate against the frozen assignment
        // and use its question count.
        const result =
          calculateSessionCompletion(
            session,
            responseSnapshot.docs
          );

        const timestamp =
          this.getTimestamp();

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

            rankEligible:
              result.rankEligible,
          }
        );

        return {
          id: sessionSnapshot.id,
          ...session,
          status: "completed",
          completionStatus:
            result.completionStatus,
          rankEligible:
            result.rankEligible,
          result,
        };
      }
    );
  }
}

module.exports = FirestoreSessionRepository;
