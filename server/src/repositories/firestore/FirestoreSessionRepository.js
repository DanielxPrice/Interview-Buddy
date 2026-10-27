const SessionRepository = require("../contracts/SessionRepository");

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

  async createSession({ userId, mode, jobRole, experienceLevel }) {
    if (!userId || !mode) {
      throw new Error("userId and mode are required.");
    }

    const sessionData = {
      userId,
      mode,
      jobRole: jobRole || null,
      experienceLevel: experienceLevel || null,
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

  async findById(sessionId) {
    if (!sessionId) {
      throw new Error("sessionId is required.");
    }

    const snapshot = await this.sessions.doc(sessionId).get();

    return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
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
      const snapshot = await transaction.get(sessionRef);

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

  // Results pipeline: read graded responses for the per-question breakdown.
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
  async saveQuizAnswer({ sessionId, userId, question, answer }) {
    if (!sessionId || !userId || !question?.id || typeof answer !== "string") {
      throw sessionError(
        "Session, user, question and answer are required.",
        400,
      );
    }

    if (question.mode !== "Quiz Style" || question.active === false) {
      throw sessionError("This is not an available Quiz question.", 400);
    }

    const selectedAnswer = answer.trim();

    if (!selectedAnswer || selectedAnswer.length > 1000) {
      throw sessionError("A valid Quiz answer is required.", 400);
    }

    if (
      Array.isArray(question.options) &&
      question.options.length > 0 &&
      !question.options.some(
        (option) => normalizeAnswer(option) === normalizeAnswer(selectedAnswer),
      )
    ) {
      throw sessionError("Answer must match a provided Quiz option.", 400);
    }

    const correctAnswer = normalizeAnswer(question.correctAnswer);

    if (!correctAnswer) {
      throw sessionError("Quiz question has no configured answer.", 500);
    }

    const sessionRef = this.sessions.doc(sessionId);

    const responseRef = sessionRef.collection("responses").doc(question.id);

    return this.db.runTransaction(async (transaction) => {
      const sessionSnapshot = await transaction.get(sessionRef);

      if (!sessionSnapshot.exists) {
        throw sessionError("Session not found.", 404);
      }

      const session = sessionSnapshot.data();

      if (session.userId !== userId) {
        throw sessionError("You do not have access to this session.", 403);
      }

      if (session.mode !== "Quiz Style") {
        throw sessionError("Question mode does not match the session.", 400);
      }

      if (session.status !== "active") {
        throw sessionError("This session has already been completed.", 409);
      }

      const existing = await transaction.get(responseRef);

      if (existing.exists) {
        throw sessionError("This question has already been answered.", 409);
      }

      const isCorrect = normalizeAnswer(selectedAnswer) === correctAnswer;

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

  // SCRUM-82: Calculate and persist final session results.
  async finalizeSessionWithResults(sessionId, userId) {
    if (!sessionId || !userId) {
      throw sessionError(
        "Session ID and authenticated user are required.",
        400,
      );
    }

    const sessionRef = this.sessions.doc(sessionId);
    const responsesQuery = sessionRef.collection("responses");

    return this.db.runTransaction(async (transaction) => {
      const sessionSnapshot = await transaction.get(sessionRef);

      if (!sessionSnapshot.exists) {
        throw sessionError("Session not found.", 404);
      }

      const session = sessionSnapshot.data();

      if (session.userId !== userId) {
        throw sessionError("You do not have access to this session.", 403);
      }

      // Repeated completion must not apply results twice.
      if (session.status === "completed") {
        return {
          id: sessionSnapshot.id,
          ...session,
        };
      }

      if (session.status !== "active") {
        throw sessionError("This session cannot be completed.", 409);
      }

      // Read graded answers inside the same transaction.
      const responseSnapshot = await transaction.get(responsesQuery);

      const responses = responseSnapshot.docs.map((doc) => doc.data());

      let totalScore = 0;

      for (const response of responses) {
        const score = response?.evaluation?.score;

        if (
          response?.mode !== session.mode ||
          typeof score !== "number" ||
          !Number.isFinite(score) ||
          score < 0 ||
          score > 100
        ) {
          throw sessionError(
            "Saved responses contain invalid scoring data.",
            409,
          );
        }

        totalScore += score;
      }

      const result = {
        score: responses.length ? Math.round(totalScore / responses.length) : 0,
        questionsAnswered: responses.length,
        totalScore,
      };

      const timestamp = this.getTimestamp();

      transaction.update(sessionRef, {
        status: "completed",
        completedAt: timestamp,
        updatedAt: timestamp,
        result,
      });

      return {
        id: sessionSnapshot.id,
        ...session,
        status: "completed",
        result,
      };
    });
  }
}

module.exports = FirestoreSessionRepository;
