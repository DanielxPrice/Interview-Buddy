
const SessionRepository = require("../contracts/SessionRepository");

/**
 * Firestore implementation for interview session persistence.
 *
 * Session documents live in the `sessions` collection. A session's
 * individual answer records live in its `responses` subcollection.
 */
class FirestoreSessionRepository extends SessionRepository {
  constructor({ db, admin }) {
    super();

    if (!db) {
      throw new Error(
        "FirestoreSessionRepository requires a Firestore db instance."
      );
    }

    this.db = db;
    this.admin = admin;
    this.sessions = db.collection("sessions");
  }

  // Server timestamps are used in production; strings keep unit tests isolated.
  getTimestamp() {
    return this.admin?.firestore?.FieldValue?.serverTimestamp
      ? this.admin.firestore.FieldValue.serverTimestamp()
      : new Date().toISOString();
  }

  async createSession({ userId, mode, jobRole, experienceLevel }) {
    if (!userId || !mode) {
      throw new Error("userId and mode are required.");
    }

    const sessionData = {
      userId,
      mode,
      jobRole: jobRole || null,
      experienceLevel: experienceLevel || null,
      status: "active",
      createdAt: this.getTimestamp(),
      updatedAt: this.getTimestamp(),
      completedAt: null,
    };

    const sessionRef = await this.sessions.add(sessionData);

    return {
      id: sessionRef.id,
      ...sessionData,
    };
  }

  // The API route checks ownership before returning session details.
  async findById(sessionId) {
    if (!sessionId) {
      throw new Error("sessionId is required.");
    }

    const snapshot = await this.sessions.doc(sessionId).get();

    if (!snapshot.exists) {
      return null;
    }

    return {
      id: snapshot.id,
      ...snapshot.data(),
    };
  }

  // Existing query: retain compatibility with callers needing all sessions.
  async listByUser(userId) {
    if (!userId) {
      throw new Error("userId is required.");
    }

    const snapshot = await this.sessions
      .where("userId", "==", userId)
      .orderBy("createdAt", "desc")
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
  }

  // Sprint 4: history must include only completed sessions for this user.
  async listCompletedByUser(userId) {
    if (!userId) {
      throw new Error("userId is required.");
    }

    const snapshot = await this.sessions
      .where("userId", "==", userId)
      .where("status", "==", "completed")
      .orderBy("completedAt", "desc")
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
  }

  // Existing completion behavior; results persistence follows in SCRUM-82.
  async completeSession(sessionId) {
    if (!sessionId) {
      throw new Error("sessionId is required.");
    }

    const sessionRef = this.sessions.doc(sessionId);

    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(sessionRef);

      if (!snapshot.exists) {
        return null;
      }

      const session = snapshot.data();

      if (session.status === "completed") {
        return {
          id: snapshot.id,
          ...session,
        };
      }

      const completedAt = this.getTimestamp();
      const updatedAt = this.getTimestamp();

      transaction.update(sessionRef, {
        status: "completed",
        completedAt,
        updatedAt,
      });

      return {
        id: snapshot.id,
        ...session,
        status: "completed",
        // Firestore serverTimestamp() is a sentinel, not a resolved timestamp.
        // The persisted timestamp is available on a subsequent read.
      };
    });
  }
}

module.exports = FirestoreSessionRepository;
