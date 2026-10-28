
"use strict";

// Workflow status remains "completed" for History.
// completionStatus describes actual interview progress.

const COMPLETION_STATUSES = Object.freeze({
  COMPLETED: "completed",
  PARTIAL: "partial",
  ABANDONED: "abandoned",
});

function completionError(
  message,
  code = "INVALID_SCORING_DATA"
) {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = code;
  return error;
}

function calculateSessionCompletion(
  session,
  responseDocs
) {
  const count = session?.questionCount;

  // A valid SEC-03 session has between
  // 1 and 20 expected questions.
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 20
  ) {
    throw completionError(
      "Session has no valid assigned question count.",
      "SESSION_ASSIGNMENT_INVALID"
    );
  }

  if (!Array.isArray(responseDocs)) {
    throw completionError(
      "Saved responses contain invalid scoring data."
    );
  }

  const ids = session.assignedQuestionIds;

  // A user may end an interview before
  // question retrieval succeeds.
  if (session.assignmentStatus === "pending") {
    if (
      responseDocs.length !== 0 ||
      (
        Array.isArray(ids) &&
        ids.length !== 0
      )
    ) {
      throw completionError(
        "Session assignment and responses are inconsistent.",
        "SESSION_ASSIGNMENT_INVALID"
      );
    }

    return {
      score: 0,
      totalScore: 0,
      questionsAnswered: 0,
      questionsAssigned: count,
      questionsUnanswered: count,
      answeredAverageScore: null,
      completionStatus:
        COMPLETION_STATUSES.ABANDONED,
      rankEligible: false,
    };
  }

  // A finalized assignment must have exactly
  // the originally requested number of
  // unique question IDs.
  if (
    session.assignmentStatus !== "assigned" ||
    !Array.isArray(ids) ||
    ids.length !== count ||
    ids.some(
      (id) =>
        typeof id !== "string" ||
        !id.trim()
    ) ||
    new Set(ids).size !== count
  ) {
    throw completionError(
      "Session question assignment is invalid.",
      "SESSION_ASSIGNMENT_INVALID"
    );
  }

  const allowed = new Set(ids);
  const answered = new Set();

  let totalScore = 0;

  // Every persisted response must belong
  // to the original assigned question set.
  for (const doc of responseDocs) {
    const response = doc?.data?.();
    const questionId = response?.questionId;
    const score = response?.evaluation?.score;

    if (
      !response ||
      typeof questionId !== "string" ||
      doc.id !== questionId ||
      !allowed.has(questionId) ||
      answered.has(questionId) ||
      response.mode !== session.mode ||
      typeof score !== "number" ||
      !Number.isFinite(score) ||
      score < 0 ||
      score > 100
    ) {
      throw completionError(
        "Saved responses contain invalid scoring data."
      );
    }

    answered.add(questionId);
    totalScore += score;
  }

  const questionsAnswered = answered.size;

  const completionStatus =
    questionsAnswered === 0
      ? COMPLETION_STATUSES.ABANDONED
      : questionsAnswered === count
        ? COMPLETION_STATUSES.COMPLETED
        : COMPLETION_STATUSES.PARTIAL;

  return {
    // Unanswered questions contribute
    // zero to the overall interview score.
    score: Math.round(totalScore / count),

    totalScore,
    questionsAnswered,
    questionsAssigned: count,

    questionsUnanswered:
      count - questionsAnswered,

    // Informational: average of attempted
    // answers, not the official score.
    answeredAverageScore:
      questionsAnswered
        ? Math.round(
            totalScore / questionsAnswered
          )
        : null,

    completionStatus,

    rankEligible:
      completionStatus ===
      COMPLETION_STATUSES.COMPLETED,
  };
}

module.exports = {
  calculateSessionCompletion,
  COMPLETION_STATUSES,
};
