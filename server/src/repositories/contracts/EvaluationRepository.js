
/**
 * Data-access contract for persisted AI
 * answer evaluations.
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
    userId,
    sessionId,
    questionId,
    questionPrompt,
    mode,
    candidateResponse,
    evaluation,
    metadata,
    evaluatedAt,
  }) {
    throw new Error(
      "saveEvaluation() must be implemented."
    );
  }
}

module.exports = EvaluationRepository;
