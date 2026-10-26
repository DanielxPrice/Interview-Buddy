// src/utils/sessionResults.js
//
// Client side of the results pipeline.
//
// The server (sessionResultsService) calculates the official result when a
// session is completed. This file does two things with what comes back:
//
//   1. getEndSessionErrorMessage: turns the server's error `code` into a
//      message a user can act on, instead of showing raw error text.
//   2. buildSessionResult: builds the object the results page displays,
//      using the server's numbers (score, ELO, date) as the source of truth
//      and the browser's answer details (your answer, rubric, etc.) for the
//      extra information the server does not send back.

// One message per server error code. Anything not listed here falls back to
// a generic "try again" message.
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
});

const DEFAULT_END_SESSION_ERROR =
  "Unable to complete the interview session. Please try again.";

const NETWORK_ERROR =
  "Could not reach the server. Check your connection and try again.";

// Codes where clicking "End Interview" again will not help.
const NON_RETRYABLE_CODES = new Set([
  "SESSION_ID_REQUIRED",
  "SESSION_NOT_FOUND",
  "SESSION_FORBIDDEN",
  "SESSION_NOT_ACTIVE",
]);

function getEndSessionErrorMessage(error) {
  const code = error?.code;

  if (code && END_SESSION_ERROR_MESSAGES[code]) {
    return END_SESSION_ERROR_MESSAGES[code];
  }

  // fetch() throws a TypeError with no HTTP status when the network fails.
  if (error instanceof TypeError && !error.status) {
    return NETWORK_ERROR;
  }

  return DEFAULT_END_SESSION_ERROR;
}

function isRetryableEndSessionError(error) {
  return !NON_RETRYABLE_CODES.has(error?.code);
}

// Same thresholds the server uses; only needed if the server response is
// missing eloChange (for example an older server version).
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
    (sum, answer) => sum + Number(answer.score || 0),
    0
  );

  return Math.round(total / answers.length);
}

function formatCompletedDate(isoString) {
  const date = isoString ? new Date(isoString) : new Date();

  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// Combine the server breakdown with the browser's answer details.
// Server values win for score and correctness; browser values fill in the
// details the server does not return (your answer, rubric, strengths...).
function mergeBreakdown(serverBreakdown, localAnswers) {
  const localById = new Map(
    localAnswers.map((answer) => [answer.questionId, answer])
  );

  if (!serverBreakdown.length) {
    return localAnswers.map((answer) => ({
      ...answer,
      prompt: answer.prompt || answer.question || "",
    }));
  }

  return serverBreakdown.map((serverItem) => {
    const local = localById.get(serverItem.questionId) || {};

    return {
      ...local,
      questionId: serverItem.questionId,
      prompt:
        serverItem.questionPrompt || local.prompt || local.question || "",
      score: Number.isFinite(serverItem.score) ? serverItem.score : local.score,
      isCorrect:
        typeof serverItem.isCorrect === "boolean"
          ? serverItem.isCorrect
          : local.isCorrect,
      feedback: serverItem.feedback || local.feedback || "",
    };
  });
}

function buildSessionResult({
  savedSession,
  answeredQuestions = [],
  mode,
  setupData = {},
}) {
  const serverScore = savedSession?.result?.score;
  const hasServerScore = Number.isFinite(serverScore);

  const score = hasServerScore ? serverScore : averageScore(answeredQuestions);

  const serverBreakdown = Array.isArray(savedSession?.breakdown)
    ? savedSession.breakdown
    : [];

  const perQuestion = mergeBreakdown(serverBreakdown, answeredQuestions);

  const questionsAnswered = Number.isFinite(
    savedSession?.result?.questionsAnswered
  )
    ? savedSession.result.questionsAnswered
    : answeredQuestions.length;

  const lastAnswer = perQuestion[perQuestion.length - 1];

  return {
    sessionId: savedSession?.id || setupData.id || null,
    mode,
    date: formatCompletedDate(savedSession?.completedAt),
    score: `${score}%`,
    questionsAnswered,
    eloChange: savedSession?.eloChange || calculateEloChange(score),
    isCorrect: Boolean(lastAnswer?.isCorrect),
    answerSubmitted: questionsAnswered > 0,
    perQuestion,
    // false only when the server told us it could not load the breakdown.
    breakdownAvailable: savedSession?.breakdownAvailable !== false,
    scoreSource: hasServerScore ? "server" : "local",
    jobRole: setupData.jobRole || "",
    experienceLevel: setupData.experienceLevel || "",
    tags: setupData.tags || [],
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