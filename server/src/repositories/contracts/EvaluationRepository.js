/**
 * Data-access contract for persisted AI answer evaluations.
 *
 * The application layer only knows about this method. It does not know how
 * sessions or nested responses are represented in Firestore.
 */
class EvaluationRepository {
  constructor() {
    if (new.target === EvaluationRepository) {
      throw new Error(
        "EvaluationRepository is an interface and cannot be instantiated directly."
      );
    }
  }

  async saveEvaluation({
    sessionId,
    questionId,
    questionPrompt,
    mode,
    candidateResponse,
    evaluation,
    metadata,
    evaluatedAt,
  }) {
    throw new Error("saveEvaluation() must be implemented.");
  }
}

module.exports = EvaluationRepository;
