
import { auth } from "../config/firebase";

const API_BASE_URL = (
  process.env.REACT_APP_API_BASE_URL ||
  "http://localhost:5001/api"
).replace(/\/$/, "");

async function getAuthorizedJson(path) {
  const user = auth.currentUser;

  if (!user) {
    throw new Error(
      "Sign in to view your interview history."
    );
  }

  const token = await user.getIdToken();

  const response = await fetch(
    `${API_BASE_URL}${path}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  let body = null;

  try {
    body = await response.json();
  } catch (_) {
    // Handle responses that do not contain JSON.
  }

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }

    if (
      response.status === 401 ||
      response.status === 403
    ) {
      throw new Error(
        "You do not have permission to view these session results."
      );
    }

    throw new Error(
      body?.error ||
      body?.message ||
      "Unable to retrieve interview history."
    );
  }

  return body;
}

export const historyService = {
  // History list: summary records only.
  async getSessions() {
    const sessions =
      await getAuthorizedJson(
        "/sessions?status=completed"
      );

    if (!Array.isArray(sessions)) {
      throw new Error(
        "The server returned an invalid history response."
      );
    }

    return sessions;
  },

  // Existing lightweight session endpoint.
  async getSessionById(sessionId) {
    if (!sessionId) {
      throw new Error(
        "Session ID is required."
      );
    }

    return getAuthorizedJson(
      `/sessions/${encodeURIComponent(sessionId)}`
    );
  },

  // SEC-03 M06:
  // Read saved results and public question feedback.
  async getCompletedSessionResults(sessionId) {
    if (!sessionId) {
      throw new Error(
        "Session ID is required."
      );
    }

    return getAuthorizedJson(
      `/sessions/${encodeURIComponent(sessionId)}/results`
    );
  },

  // No deletion API is implemented.
  async deleteSession() {
    throw new Error(
      "Deleting interview history is not supported by the current backend."
    );
  },
};
