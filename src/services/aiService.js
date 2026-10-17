import { auth } from "../config/firebase";

/**
 * React-facing AI evaluation service.
 *
 * The browser sends only a question id and the candidate's response. The
 * backend reloads the private reference answer and weighted grading rubric
 * from Firestore before calling the AI provider.
 */

const API_BASE_URL = (
  process.env.REACT_APP_API_BASE_URL || "http://localhost:5001/api"
).replace(/\/$/, "");

async function getIdToken() {
  const user = auth.currentUser;

  if (!user) {
    throw new Error("Authenticated Firebase user is required.");
  }

  return user.getIdToken();
}

async function readJsonResponse(response) {
  let payload = null;

  try {
    payload = await response.json();
  } catch (error) {
    // The HTTP status still gives the caller a useful error below.
  }

  if (!response.ok) {
    const message =
      payload?.error ||
      payload?.message ||
      `AI evaluation request failed (${response.status}).`;
    throw new Error(message);
  }

  return payload;
}

export const aiService = {
  async evaluateAnswer({
    questionId,
    userAnswer,
    sessionId = null,
    jobRole = "",
    experienceLevel = "",
  } = {}) {
    if (!questionId) {
      throw new Error("Question ID is required.");
    }

    if (!userAnswer || !String(userAnswer).trim()) {
      throw new Error("User answer is required.");
    }

    const idToken = await getIdToken();

    const response = await fetch(`${API_BASE_URL}/evaluate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        requestId: `evaluation-${Date.now()}`,
        questionId,
        candidateResponse: String(userAnswer).trim(),
        metadata: {
          sessionId,
          jobRole,
          experienceLevel,
        },
      }),
    });

    const payload = await readJsonResponse(response);

    if (!payload?.evaluation) {
      throw new Error("AI evaluation response was missing evaluation data.");
    }

    return payload.evaluation;
  },
};
