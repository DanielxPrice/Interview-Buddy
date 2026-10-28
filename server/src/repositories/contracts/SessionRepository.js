
/** Repository contract for Interview Buddy sessions. */
/* eslint-disable no-unused-vars */

class SessionRepository {
  constructor() {
    if (new.target === SessionRepository) {
      throw new Error(
        "SessionRepository is an interface and cannot be instantiated directly."
      );
    }
  }

  async createSession({
    userId,
    mode,
    jobRole,
    experienceLevel,
  }) {
    throw new Error(
      "createSession() must be implemented."
    );
  }

  // Freeze the authoritative public question set.
  async assignQuestions({
    sessionId,
    userId,
    setup,
    questions,
  }) {
    throw new Error(
      "assignQuestions() must be implemented."
    );
  }

  async findById(sessionId) {
    throw new Error(
      "findById() must be implemented."
    );
  }

  async listByUser(userId) {
    throw new Error(
      "listByUser() must be implemented."
    );
  }

  async listCompletedByUser(userId) {
    throw new Error(
      "listCompletedByUser() must be implemented."
    );
  }

  // Legacy status-only method.
  async completeSession(sessionId) {
    throw new Error(
      "completeSession() must be implemented."
    );
  }

  async saveQuizAnswer({
    sessionId,
    userId,
    question,
    answer,
  }) {
    throw new Error(
      "saveQuizAnswer() must be implemented."
    );
  }

  async listResponses(sessionId) {
    throw new Error(
      "listResponses() must be implemented."
    );
  }

  async finalizeSessionWithResults(
    sessionId,
    userId
  ) {
    throw new Error(
      "finalizeSessionWithResults() must be implemented."
    );
  }
}

module.exports = SessionRepository;
