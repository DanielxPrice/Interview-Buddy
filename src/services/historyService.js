
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

  // SEC-05: explicit, bounded history retrieval. Unlike the legacy array API,
  // this response includes a cursor for loading older sessions on demand.
  async getSessionPage({ cursor = null, pageSize = 25 } = {}) {
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
      throw new Error("History page size must be between 1 and 50.");
    }
    const params = new URLSearchParams({ status: "completed", pageSize: String(pageSize) });
    if (cursor) params.set("cursor", cursor);
    const payload = await getAuthorizedJson(`/sessions?${params.toString()}`);
    if (!payload || !Array.isArray(payload.sessions) ||
        (payload.nextCursor !== null && typeof payload.nextCursor !== "string")) {
      throw new Error("The server returned an invalid history page.");
    }
    return payload;
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
