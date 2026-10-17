/**
 * Data-access contract used by the Interview Buddy application layer.
 *
 * Routes and services depend on this interface rather than on Firestore.
 * Concrete adapters (for example FirestoreQuestionRepository) implement the
 * persistence details behind these methods.
 */
class QuestionRepository {
  constructor() {
    if (new.target === QuestionRepository) {
      throw new Error(
        "QuestionRepository is an interface and cannot be instantiated directly."
      );
    }
  }

  async findByMode(mode) {
    throw new Error("findByMode() must be implemented.");
  }

  async findById(questionId) {
    throw new Error("findById() must be implemented.");
  }

  async upsertMany(questions) {
    throw new Error("upsertMany() must be implemented.");
  }
}

module.exports = QuestionRepository;
