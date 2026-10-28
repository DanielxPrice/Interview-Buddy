
// Client-side adapter for server-calculated interview results.
// The server remains authoritative for scoring and rank eligibility.

const END_SESSION_ERROR_MESSAGES = Object.freeze({
  SESSION_ID_REQUIRED:
    "This session could not be identified. Start a new session to continue.",

  SESSION_NOT_FOUND:
    "This session no longer exists. Start a new session to continue.",

  SESSION_FORBIDDEN:
    "This session belongs to a different account. Sign in with the account that started it.",

  SESSION_NOT_ACTIVE:
    "This session can no longer be completed. Start a new session to continue.",

  INVALID_SCORING_DATA:
    "Some of your saved answers could not be scored, so results could not be calculated. Please try again.",

  RESULTS_CALCULATION_FAILED:
    "Your results could not be calculated right now. Please try again.",

  SESSION_ASSIGNMENT_INVALID:
    "This session has an incomplete or invalid question assignment. Please start a new session.",
});

const DEFAULT_END_SESSION_ERROR =
  "Unable to complete the interview session. Please try again.";

const NETWORK_ERROR =
  "Could not reach the server. Check your connection and try again.";

const NON_RETRYABLE_CODES = new Set([
  "SESSION_ID_REQUIRED",
  "SESSION_NOT_FOUND",
  "SESSION_FORBIDDEN",
  "SESSION_NOT_ACTIVE",
  "SESSION_ASSIGNMENT_INVALID",
]);

function getEndSessionErrorMessage(error) {
  const code = error?.code;

  if (code && END_SESSION_ERROR_MESSAGES[code]) {
    return END_SESSION_ERROR_MESSAGES[code];
  }

  if (error instanceof TypeError && !error.status) {
    return NETWORK_ERROR;
  }

  return DEFAULT_END_SESSION_ERROR;
}

function isRetryableEndSessionError(error) {
  return !NON_RETRYABLE_CODES.has(error?.code);
}

// Used only as a display estimate after
// the server confirms ranking eligibility.
function calculateEloChange(score) {
  if (score >= 70) {
    return "+2";
  }

  if (score >= 50) {
    return "+1";
  }

  return "-2";
}

function averageScore(answers) {
  if (!answers.length) {
    return 0;
  }

  const total = answers.reduce(
    (sum, answer) =>
      sum + Number(answer.score || 0),
    0
  );

  return Math.round(total / answers.length);
}

function formatCompletedDate(isoString) {
  const date = isoString
    ? new Date(isoString)
    : new Date();

  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function mergeBreakdown(
  serverBreakdown,
  localAnswers
) {
  const localById = new Map(
    localAnswers.map((answer) => [
      answer.questionId,
      answer,
    ])
  );

  if (!serverBreakdown.length) {
    return localAnswers.map((answer) => ({
      ...answer,
      prompt:
        answer.prompt ||
        answer.question ||
        "",
    }));
  }

  return serverBreakdown.map((serverItem) => {
    const local =
      localById.get(serverItem.questionId) || {};

    return {
      ...local,

      questionId: serverItem.questionId,

      prompt:
        serverItem.questionPrompt ||
        local.prompt ||
        local.question ||
        "",

      score: Number.isFinite(serverItem.score)
        ? serverItem.score
        : local.score,

      isCorrect:
        typeof serverItem.isCorrect === "boolean"
          ? serverItem.isCorrect
          : local.isCorrect,

      feedback:
        serverItem.feedback ||
        local.feedback ||
        "",
    };
  });
}

function buildSessionResult({
  savedSession,
  answeredQuestions = [],
  mode,
  setupData = {},
}) {
  const serverScore =
    savedSession?.result?.score;

  const hasServerScore =
    Number.isFinite(serverScore);

  const score = hasServerScore
    ? serverScore
    : averageScore(answeredQuestions);

  const serverBreakdown =
    Array.isArray(savedSession?.breakdown)
      ? savedSession.breakdown
      : [];

  const perQuestion = mergeBreakdown(
    serverBreakdown,
    answeredQuestions
  );

  const questionsAnswered =
    Number.isFinite(
      savedSession?.result?.questionsAnswered
    )
      ? savedSession.result.questionsAnswered
      : answeredQuestions.length;

  const lastAnswer =
    perQuestion[perQuestion.length - 1];

  const completionStatus =
    savedSession?.result?.completionStatus ||
    savedSession?.completionStatus ||
    null;

  const rankEligible =
    savedSession?.result?.rankEligible === true;

  return {
    sessionId:
      savedSession?.id ||
      setupData.id ||
      null,

    mode,

    date: formatCompletedDate(
      savedSession?.completedAt
    ),

    score: `${score}%`,

    questionsAnswered,

    completionStatus,

    questionsAssigned:
      savedSession?.result?.questionsAssigned ??
      null,

    questionsUnanswered:
      savedSession?.result?.questionsUnanswered ??
      null,

    rankEligible,

    eloChange:
      rankEligible &&
      completionStatus === "completed"
        ? (
            savedSession?.eloChange ??
            calculateEloChange(score)
          )
        : null,

    isCorrect: Boolean(lastAnswer?.isCorrect),

    answerSubmitted:
      questionsAnswered > 0,

    perQuestion,

    breakdownAvailable:
      savedSession?.breakdownAvailable !== false,

    scoreSource: hasServerScore
      ? "server"
      : "local",

    jobRole:
      setupData.jobRole || "",

    experienceLevel:
      setupData.experienceLevel || "",

    tags:
      setupData.tags || [],
  };
}

export {
  END_SESSION_ERROR_MESSAGES,
  getEndSessionErrorMessage,
  isRetryableEndSessionError,
  buildSessionResult,
  calculateEloChange,
  formatCompletedDate,
};
