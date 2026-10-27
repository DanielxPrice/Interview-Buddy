
const RESULTS_ERROR_CODES = Object.freeze({
  SESSION_ID_REQUIRED: "SESSION_ID_REQUIRED",
  SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
  SESSION_FORBIDDEN: "SESSION_FORBIDDEN",
  SESSION_NOT_ACTIVE: "SESSION_NOT_ACTIVE",
  INVALID_SCORING_DATA: "INVALID_SCORING_DATA",
  RESULTS_CALCULATION_FAILED: "RESULTS_CALCULATION_FAILED",
});


class ResultsPipelineError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.name = "ResultsPipelineError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

// The repository throws plain errors with a statusCode. Translate them into
// coded errors so the client gets a machine-readable reason.
function toPipelineError(error) {
  if (error instanceof ResultsPipelineError) {
    return error;
  }

  const message = error?.message || "Unable to calculate session results.";

  switch (error?.statusCode) {
    case 400:
      return new ResultsPipelineError(
        message,
        400,
        RESULTS_ERROR_CODES.SESSION_ID_REQUIRED
      );
    case 403:
      return new ResultsPipelineError(
        message,
        403,
        RESULTS_ERROR_CODES.SESSION_FORBIDDEN
      );
    case 404:
      return new ResultsPipelineError(
        message,
        404,
        RESULTS_ERROR_CODES.SESSION_NOT_FOUND
      );
    case 409:
      // The repository uses 409 both for "not active" and for corrupt
      // scores; the message tells them apart.
      return new ResultsPipelineError(
        message,
        409,
        /scoring data/i.test(message)
          ? RESULTS_ERROR_CODES.INVALID_SCORING_DATA
          : RESULTS_ERROR_CODES.SESSION_NOT_ACTIVE
      );
    default:
      // Unknown failure (Firestore outage, bug). Hide internal details.
      return new ResultsPipelineError(
        "Unable to calculate session results. Please try again.",
        500,
        RESULTS_ERROR_CODES.RESULTS_CALCULATION_FAILED
      );
  }
}

// Same thresholds the client used before, now decided on the server so every
// screen shows the same number.
function calculateEloChange(score) {
  if (score >= 70) {
    return "+2";
  }

  if (score >= 50) {
    return "+1";
  }

  return "-2";
}

// Firestore Timestamps, Dates and ISO strings all become an ISO string.
function toIsoString(value) {
  if (!value) {
    return null;
  }

  if (typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    return value;
  }

  return null;
}

function toBreakdownItem(response) {
  const evaluation = response?.evaluation || {};

  return {
    questionId: response?.questionId || null,
    questionPrompt: response?.questionPrompt || "",
    score: Number.isFinite(evaluation.score) ? evaluation.score : null,
    isCorrect:
      typeof evaluation.isCorrect === "boolean" ? evaluation.isCorrect : null,
    feedback: evaluation.feedback || evaluation.summary || "",
  };
}

function createSessionResultsService({ sessionRepository, logger = console }) {
  if (!sessionRepository) {
    throw new Error("createSessionResultsService requires sessionRepository.");
  }

  async function checkAccess(sessionId, userId) {
    const session = await sessionRepository.findById(sessionId);

    if (!session) {
      throw new ResultsPipelineError(
        "Session not found.",
        404,
        RESULTS_ERROR_CODES.SESSION_NOT_FOUND
      );
    }

    if (session.userId !== userId) {
      throw new ResultsPipelineError(
        "You do not have access to this session.",
        403,
        RESULTS_ERROR_CODES.SESSION_FORBIDDEN
      );
    }

    return session;
  }

  // The score is already saved once finalize succeeds, so a failure here must
  // not fail the whole request. We log it and tell the client the breakdown
  // is unavailable rather than hiding a valid score.
  async function buildBreakdown(sessionId) {
    try {
      const responses = await sessionRepository.listResponses(sessionId);
      return {
        breakdown: responses.map(toBreakdownItem),
        breakdownAvailable: true,
      };
    } catch (error) {
      logger.error(
        `[results] breakdown failed for session ${sessionId}:`,
        error
      );
      return { breakdown: [], breakdownAvailable: false };
    }
  }

  // Same idea: the completion time is nice to have, not worth failing over.
  async function loadCompletedAt(sessionId) {
    try {
      const saved = await sessionRepository.findById(sessionId);
      return toIsoString(saved?.completedAt);
    } catch (error) {
      logger.error(
        `[results] completedAt lookup failed for session ${sessionId}:`,
        error
      );
      return null;
    }
  }

  async function completeSession({ sessionId, userId }) {
    if (!sessionId || !userId) {
      throw new ResultsPipelineError(
        "Session ID and authenticated user are required.",
        400,
        RESULTS_ERROR_CODES.SESSION_ID_REQUIRED
      );
    }

    try {
      await checkAccess(sessionId, userId);

      const completedSession =
        await sessionRepository.finalizeSessionWithResults(sessionId, userId);

      if (!completedSession) {
        throw new ResultsPipelineError(
          "Session not found.",
          404,
          RESULTS_ERROR_CODES.SESSION_NOT_FOUND
        );
      }

      const result = completedSession.result || {
        score: 0,
        questionsAnswered: 0,
        totalScore: 0,
      };

      const [{ breakdown, breakdownAvailable }, reloadedCompletedAt] =
        await Promise.all([
          buildBreakdown(sessionId),
          loadCompletedAt(sessionId),
        ]);

      return {
        ...completedSession,
        result,
        completedAt:
          reloadedCompletedAt ||
          toIsoString(completedSession.completedAt),
        eloChange: calculateEloChange(result.score),
        breakdown,
        breakdownAvailable,
      };
    } catch (error) {
      const pipelineError = toPipelineError(error);

      // Unexpected errors are logged with the session ID so they can be
      // traced; expected ones (404, 403, 409) are normal user outcomes.
      if (pipelineError.statusCode >= 500) {
        logger.error(
          `[results] completion failed for session ${sessionId}:`,
          error
        );
      }

      throw pipelineError;
    }
  }

  return { completeSession };
}

module.exports = {
  createSessionResultsService,
  ResultsPipelineError,
  RESULTS_ERROR_CODES,
  calculateEloChange,
};