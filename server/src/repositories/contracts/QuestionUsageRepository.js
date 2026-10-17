class QuestionUsageRepository {
  async getDailyUsage() {
    throw new Error(
      "QuestionUsageRepository.getDailyUsage must be implemented."
    );
  }

  async reserveQuestions() {
    throw new Error(
      "QuestionUsageRepository.reserveQuestions must be implemented."
    );
  }
}

module.exports =
  QuestionUsageRepository;