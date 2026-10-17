import mockSessions from "../data/mockSessions";

/**
 * React-facing session history service facade.
 *
 * Sprint 1 reads the existing mock array. A future implementation will replace
 * these internals with authenticated backend/Firebase requests.
 */
export const historyService = {
  async getSessions() {
    // Return copies so a component cannot accidentally mutate the source mocks.
    return mockSessions.map((session) => ({ ...session }));
  },

  async getSessionById(sessionId) {
    if (sessionId === undefined || sessionId === null) {
      throw new Error("Session ID is required.");
    }

    const session = mockSessions.find(
      (item) => String(item.id) === String(sessionId)
    );

    return session ? { ...session } : null;
  },

  async deleteSession(sessionId) {
    if (sessionId === undefined || sessionId === null) {
      throw new Error("Session ID is required.");
    }

    // Sprint 1 does not persist mutations. The real implementation will
    // request deletion through the backend Application Layer.
    const exists = mockSessions.some(
      (item) => String(item.id) === String(sessionId)
    );

    return {
      success: exists,
      sessionId,
      simulated: true,
    };
  },
};