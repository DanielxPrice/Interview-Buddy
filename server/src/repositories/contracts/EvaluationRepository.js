class EvaluationRepository {
  constructor() {
    if (new.target === EvaluationRepository) {
      throw new Error(
        "EvaluationRepository is an interface and cannot be instantiated directly."
      );
    }
  }

  async reserveEvaluation(_options) {
    throw new Error(
      "reserveEvaluation() must be implemented."
    );
  }

  async markProviderStarted(_options) {
    throw new Error(
      "markProviderStarted() must be implemented."
    );
  }

  async markUncertainEvaluation(_options) {
    throw new Error(
      "markUncertainEvaluation() must be implemented."
    );
  }

  async reconcileUncertainEvaluation(_options) {
    throw new Error(
      "reconcileUncertainEvaluation() must be implemented."
    );
  }

  async completeReservedEvaluation(_options) {
    throw new Error(
      "completeReservedEvaluation() must be implemented."
    );
  }

  async failReservedEvaluation(_options) {
    throw new Error(
      "failReservedEvaluation() must be implemented."
    );
  }

  async saveEvaluation(_options) {
    throw new Error(
      "saveEvaluation() must be implemented."
    );
  }
}

module.exports = EvaluationRepository;