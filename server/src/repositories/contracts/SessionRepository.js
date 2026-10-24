
/**
 * Data-access contract for Interview Buddy interview sessions.
 *
 * Routes use this interface instead of depending on Firestore details.
 */

/* eslint-disable no-unused-vars */
class SessionRepository {
  constructor() {
    if (new.target === SessionRepository) {
      throw new Error(
        "SessionRepository is an interface and cannot be instantiated directly."
      );
    }
  }

  // Create a new session owned by one user.
  async createSession({ userId, mode, jobRole, experienceLevel }) {
    throw new Error("createSession() must be implemented.");
  }

  // Return one session by ID, or null if it does not exist.
  async findById(sessionId) {
    throw new Error("findById() must be implemented.");
  }

  // Return all sessions belonging to a user, newest created first.
  async listByUser(userId) {
    throw new Error("listByUser() must be implemented.");
  }

  // Return only completed sessions for a user, newest completed first.
  // This intentionally excludes unfinished sessions from history.
  async listCompletedByUser(userId) {
    throw new Error("listCompletedByUser() must be implemented.");
  }

  // Mark a session as completed and record when it finished.
  async completeSession(sessionId) {
    throw new Error("completeSession() must be implemented.");
  }
}

module.exports = SessionRepository;
