/**
 * Data-access contract for Interview Buddy interview sessions.
 *
 * The application layer only knows about these methods. It does not know how
 * sessions are stored in Firestore.
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

  // Create a new session owned by one user. Returns the saved session,
  // including its generated id.
  async createSession({ userId, mode, jobRole, experienceLevel }) {
    throw new Error("createSession() must be implemented.");
  }

  // Return one session by id, or null if it does not exist.
  async findById(sessionId) {
    throw new Error("findById() must be implemented.");
  }

  // Return all sessions that belong to one user, newest first.
  async listByUser(userId) {
    throw new Error("listByUser() must be implemented.");
  }

  // Mark a session as completed and record when it finished.
  async completeSession(sessionId) {
    throw new Error("completeSession() must be implemented.");
  }
}

module.exports = SessionRepository;