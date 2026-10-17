const EvaluationRepository = require("../contracts/EvaluationRepository");

/**
 * Firestore implementation for storing answer evaluations.
 *
 * Firestore document layout and server timestamps stay isolated here so the
 * route/application layer remains database-independent.
 */
class FirestoreEvaluationRepository extends EvaluationRepository {
  constructor({ db, admin }) {
    super();

    if (!db) {
      throw new Error(
        "FirestoreEvaluationRepository requires a Firestore db instance."
      );
    }

    this.db = db;
    this.admin = admin;
  }

  getTimestamp(fallbackValue) {
    return this.admin?.firestore?.FieldValue?.serverTimestamp
      ? this.admin.firestore.FieldValue.serverTimestamp()
      : fallbackValue || new Date().toISOString();
  }

  async saveEvaluation({
    sessionId,
    questionId,
    questionPrompt,
    mode,
    candidateResponse,
    evaluation,
    metadata = {},
    evaluatedAt,
  }) {
    if (!sessionId || !questionId) {
      throw new Error(
        "sessionId and questionId are required to save an evaluation."
      );
    }

    const sessionReference = this.db
      .collection("sessions")
      .doc(sessionId);

    const responseReference = sessionReference
      .collection("responses")
      .doc(questionId);

    await this.db.runTransaction(async (transaction) => {
      const sessionSnapshot = await transaction.get(
        sessionReference
      );

      if (!sessionSnapshot.exists) {
        const error = new Error("Session not found.");
        error.statusCode = 404;
        throw error;
      }

      const session = sessionSnapshot.data();

      if (session.status !== "active") {
        const error = new Error(
          "This session is not active."
        );
        error.statusCode = 409;
        throw error;
      }

      const timestamp = this.getTimestamp(evaluatedAt);

      transaction.update(sessionReference, {
        updatedAt: timestamp,
      });

      transaction.set(
        responseReference,
        {
          questionId,
          questionPrompt: questionPrompt || null,
          mode: mode || null,
          candidateResponse,
          evaluation,
          evaluatedAt: timestamp,
        },
        { merge: true }
      );
    });
  }
}

module.exports = FirestoreEvaluationRepository;
