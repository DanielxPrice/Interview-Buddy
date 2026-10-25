
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

  async createSession({ userId, mode, jobRole, experienceLevel }) {
    throw new Error("createSession() must be implemented.");
  }

  async findById(sessionId) {
    throw new Error("findById() must be implemented.");
  }

  async listByUser(userId) {
    throw new Error("listByUser() must be implemented.");
  }

  async listCompletedByUser(userId) {
    throw new Error("listCompletedByUser() must be implemented.");
  }

  // Legacy status-only operation retained for existing repository callers.
  // The HTTP completion endpoint uses finalizeSessionWithResults instead.
  async completeSession(sessionId) {
    throw new Error("completeSession() must be implemented.");
  }

  // Grade and persist a Quiz response on the server.
  async saveQuizAnswer({ sessionId, userId, question, answer }) {
    throw new Error("saveQuizAnswer() must be implemented.");
  }

  // Calculate results from saved answers and complete the session atomically.
  async finalizeSessionWithResults(sessionId, userId) {
    throw new Error("finalizeSessionWithResults() must be implemented.");
  }
}

module.exports = SessionRepository;
