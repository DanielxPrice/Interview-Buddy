
const SessionRepository = require("../contracts/SessionRepository");

/**
 * Firestore implementation for interview session persistence.
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

  // Return a Firestore server timestamp when available.
  // The fallback supports isolated tests without Firebase Admin.
  getTimestamp() {
    return this.admin?.firestore?.FieldValue?.serverTimestamp
      ? this.admin.firestore.FieldValue.serverTimestamp()
      : new Date().toISOString();
  }

  // Create a new interview session.
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

  // Retrieve a session by ID.
  // Authorization is enforced by the API routes.
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

  // Retrieve a user's sessions, newest first.
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

  // Complete an existing interview session.
  async completeSession(sessionId) {
    if (!sessionId) {
      throw new Error("sessionId is required.");
    }

    const sessionRef = this.sessions.doc(sessionId);

    // Use a transaction to avoid competing updates.
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(sessionRef);

      if (!snapshot.exists) {
        return null;
      }

      const session = snapshot.data();

      // Do not complete an already completed session again.
      if (session.status === "completed") {
        return {
          id: snapshot.id,
          ...session,
        };
      }

      transaction.update(sessionRef, {
        status: "completed",
        completedAt: this.getTimestamp(),
        updatedAt: this.getTimestamp(),
      });

      return {
        id: snapshot.id,
        ...session,
        status: "completed",
      };
    });
  }
}

module.exports = FirestoreSessionRepository;
