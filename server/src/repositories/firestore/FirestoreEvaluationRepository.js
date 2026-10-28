
"use strict";

const EvaluationRepository = require(
  "../contracts/EvaluationRepository"
);

const {
  AI_GRADABLE_MODES,
} = require(
  "../../services/evaluationContract"
);

const {
  assertOwnedActiveSession,
  assertAssignedQuestion,
  reject,
} = require(
  "../../services/sessionAssignmentPolicy"
);

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
      : fallbackValue ||
          new Date().toISOString();
  }

  async saveEvaluation({
    userId,
    sessionId,
    questionId,
    questionPrompt,
    mode,
    candidateResponse,
    evaluation,
    evaluatedAt,
  }) {
    if (!userId || !sessionId || !questionId) {
      throw reject(
        "Authenticated user, session ID, and question ID are required.",
        400,
        "EVALUATION_IDENTIFIERS_REQUIRED"
      );
    }

    const sessionReference = this.db
      .collection("sessions")
      .doc(sessionId);

    const responseReference = sessionReference
      .collection("responses")
      .doc(questionId);

    await this.db.runTransaction(
      async (transaction) => {
        // Read current session state inside
        // the authoritative transaction.
        const sessionSnapshot =
          await transaction.get(
            sessionReference
          );

        const session =
          sessionSnapshot.exists
            ? sessionSnapshot.data()
            : null;

        assertOwnedActiveSession(
          session,
          userId
        );

        if (
          !AI_GRADABLE_MODES.has(mode) ||
          session.mode !== mode
        ) {
          throw reject(
            "Evaluation mode does not match the session.",
            409,
            "SESSION_MODE_MISMATCH"
          );
        }

        if (
          session.assignmentStatus !==
          "assigned"
        ) {
          throw reject(
            "This interview has no finalized question assignment.",
            409,
            "ASSIGNMENT_NOT_READY"
          );
        }

        assertAssignedQuestion(
          session,
          questionId
        );

        // Read the existing response before
        // any transaction writes.
        const priorResponse =
          await transaction.get(
            responseReference
          );

        if (priorResponse.exists) {
          throw reject(
            "This question has already been answered.",
            409,
            "QUESTION_ALREADY_ANSWERED"
          );
        }

        const timestamp =
          this.getTimestamp(evaluatedAt);

        transaction.update(
          sessionReference,
          {
            updatedAt: timestamp,
          }
        );

        // No merge: prevent overwriting
        // an existing saved grade.
        transaction.set(
          responseReference,
          {
            questionId,
            questionPrompt:
              questionPrompt || null,
            mode,
            candidateResponse,
            evaluation,
            evaluatedAt: timestamp,
          }
        );
      }
    );
  }
}

module.exports = FirestoreEvaluationRepository;
