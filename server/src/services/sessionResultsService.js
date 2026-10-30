
const RESULTS_ERROR_CODES = Object.freeze({
  SESSION_ID_REQUIRED: "SESSION_ID_REQUIRED",
  SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
  SESSION_FORBIDDEN: "SESSION_FORBIDDEN",
  SESSION_NOT_ACTIVE: "SESSION_NOT_ACTIVE",
  INVALID_SCORING_DATA: "INVALID_SCORING_DATA",
  RESULTS_CALCULATION_FAILED: "RESULTS_CALCULATION_FAILED",
  SESSION_ASSIGNMENT_INVALID:
    "SESSION_ASSIGNMENT_INVALID",
});

class ResultsPipelineError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.name = "ResultsPipelineError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function toPipelineError(error) {
  if (error instanceof ResultsPipelineError) {
    return error;
  }

  const message =
    error?.message ||
    "Unable to calculate session results.";

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
      return new ResultsPipelineError(
        message,
        409,
        error.code ===
          RESULTS_ERROR_CODES.INVALID_SCORING_DATA ||
        error.code ===
          RESULTS_ERROR_CODES.SESSION_ASSIGNMENT_INVALID
          ? error.code
          : /scoring data/i.test(message)
            ? RESULTS_ERROR_CODES.INVALID_SCORING_DATA
            : RESULTS_ERROR_CODES.SESSION_NOT_ACTIVE
      );

    default:
      // Do not expose internal database failures to clients.
      return new ResultsPipelineError(
        "Unable to calculate session results. Please try again.",
        500,
        RESULTS_ERROR_CODES.RESULTS_CALCULATION_FAILED
      );
  }
}

// Display estimate only.
// This function does not update a ranking database.
function calculateEloChange(score) {
  if (score >= 70) {
    return "+2";
  }

  if (score >= 50) {
    return "+1";
  }

  return "-2";
}

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

// Convert a saved response into public feedback.
// Never return arbitrary Firestore response fields.
function toBreakdownItem(response) {
  const evaluation = response?.evaluation || {};

  const item = {
    questionId: response?.questionId || null,

    questionPrompt:
      response?.questionPrompt || "",

    score:
      Number.isFinite(evaluation.score)
        ? evaluation.score
        : null,

    isCorrect:
      typeof evaluation.isCorrect === "boolean"
        ? evaluation.isCorrect
        : null,

    feedback:
      evaluation.feedback ||
      evaluation.summary ||
      "",
  };

  if (
    typeof response?.candidateResponse === "string"
  ) {
    item.userAnswer = response.candidateResponse;
  }

  for (const name of [
    "strengths",
    "weaknesses",
    "suggestions",
  ]) {
    if (Array.isArray(evaluation[name])) {
      item[name] = evaluation[name]
        .filter(
          (value) => typeof value === "string"
        )
        .slice(0, 6);
    }
  }

  if (
    Array.isArray(evaluation.criterionResults)
  ) {
    item.criterionResults =
      evaluation.criterionResults.map(
        (criterion) => ({
          name: String(
            criterion?.name || ""
          ),

          awardedPoints:
            Number.isFinite(
              criterion?.awardedPoints
            )
              ? criterion.awardedPoints
              : null,

          maxPoints:
            Number.isFinite(
              criterion?.maxPoints
            )
              ? criterion.maxPoints
              : null,

          feedback: String(
            criterion?.feedback || ""
          ),
        })
      );
  }

  return item;
}

function createSessionResultsService({
  sessionRepository,
  logger = console,
}) {
  if (!sessionRepository) {
    throw new Error(
      "createSessionResultsService requires sessionRepository."
    );
  }

  // Confirm the session exists and belongs
  // to the Firebase-authenticated user.
  async function checkAccess(sessionId, userId) {
    const session =
      await sessionRepository.findById(sessionId);

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

  // Loading feedback is best-effort.
  // A feedback read failure should not erase the saved score.
  async function buildBreakdown(sessionId) {
    try {
      const responses =
        await sessionRepository.listResponses(
          sessionId
        );

      return {
        breakdown:
          responses.map(toBreakdownItem),

        breakdownAvailable: true,
      };
    } catch (error) {
      logger.error(
        `[results] breakdown failed for session ${sessionId}:`,
        error
      );

      return {
        breakdown: [],
        breakdownAvailable: false,
      };
    }
  }

  async function loadCompletedAt(sessionId) {
    try {
      const saved =
        await sessionRepository.findById(
          sessionId
        );

      return toIsoString(
        saved?.completedAt
      );
    } catch (error) {
      logger.error(
        `[results] completedAt lookup failed for session ${sessionId}:`,
        error
      );

      return null;
    }
  }

  // Finalization writes the authoritative result once.
  async function completeSession({
    sessionId,
    userId,
  }) {
    if (!sessionId || !userId) {
      throw new ResultsPipelineError(
        "Session ID and authenticated user are required.",
        400,
        RESULTS_ERROR_CODES.SESSION_ID_REQUIRED
      );
    }

    try {
      await checkAccess(
        sessionId,
        userId
      );

      const completedSession =
        await sessionRepository.finalizeSessionWithResults(
          sessionId,
          userId
        );

      if (!completedSession) {
        throw new ResultsPipelineError(
          "Session not found.",
          404,
          RESULTS_ERROR_CODES.SESSION_NOT_FOUND
        );
      }

      const result =
        completedSession.result || {
          score: 0,
          questionsAnswered: 0,
          totalScore: 0,
        };

      const [
        {
          breakdown,
          breakdownAvailable,
        },
        reloadedCompletedAt,
      ] = await Promise.all([
        buildBreakdown(sessionId),
        loadCompletedAt(sessionId),
      ]);

      return {
        ...completedSession,
        result,

        completedAt:
          reloadedCompletedAt ||
          toIsoString(
            completedSession.completedAt
          ),

        eloChange:
          result.rankEligible === true &&
          result.completionStatus === "completed"
            ? calculateEloChange(
                result.score
              )
            : null,

        breakdown,
        breakdownAvailable,
      };
    } catch (error) {
      const pipelineError =
        toPipelineError(error);

      if (
        pipelineError.statusCode >= 500
      ) {
        logger.error(
          `[results] completion failed for session ${sessionId}:`,
          error
        );
      }

      throw pipelineError;
    }
  }

  // SEC-03 M06:
  // Read the completed result without changing Firestore.
  async function getCompletedSessionResults({
    sessionId,
    userId,
  }) {
    if (!sessionId || !userId) {
      throw new ResultsPipelineError(
        "Session ID and authenticated user are required.",
        400,
        RESULTS_ERROR_CODES.SESSION_ID_REQUIRED
      );
    }

    try {
      // Authorization happens BEFORE loading answers.
      const session =
        await checkAccess(
          sessionId,
          userId
        );

      if (session.status !== "completed") {
        throw new ResultsPipelineError(
          "This session has not been completed.",
          409,
          RESULTS_ERROR_CODES.SESSION_NOT_ACTIVE
        );
      }

      const {
        breakdown,
        breakdownAvailable,
      } = await buildBreakdown(
        sessionId
      );

      const result =
        session.result || null;

      const isRanked =
        result?.rankEligible === true &&
        result?.completionStatus === "completed" &&
        Number.isFinite(result?.score);

      return {
        id: session.id || sessionId,
        status: session.status,
        mode: session.mode,

        jobRole:
          session.jobRole || "",

        experienceLevel:
          session.experienceLevel || "",

        tags:
          Array.isArray(session.tags)
            ? session.tags
            : [],

        completedAt:
          toIsoString(
            session.completedAt
          ),

        result,

        completionStatus:
          result?.completionStatus ??
          session.completionStatus ??
          null,

        rankEligible:
          result?.rankEligible ??
          session.rankEligible ??
          null,

        eloChange:
          isRanked
            ? calculateEloChange(
                result.score
              )
            : null,

        breakdown,
        breakdownAvailable,
      };
    } catch (error) {
      const pipelineError =
        toPipelineError(error);

      if (
        pipelineError.statusCode >= 500
      ) {
        logger.error(
          `[results] saved result retrieval failed for session ${sessionId}:`,
          error
        );
      }

      throw pipelineError;
    }
  }

  return {
    completeSession,
    getCompletedSessionResults,
  };
}

module.exports = {
  createSessionResultsService,
  ResultsPipelineError,
  RESULTS_ERROR_CODES,
  calculateEloChange,
};
