
const {
  createSessionResultsService,
  ResultsPipelineError,
  RESULTS_ERROR_CODES,
  calculateEloChange,
} = require("./sessionResultsService");

function repositoryError(
  message,
  statusCode
) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

describe("sessionResultsService", () => {
  let sessionRepository;
  let logger;
  let service;

  const activeSession = {
    id: "session-1",
    userId: "user-1",
    mode: "Quiz Style",
    status: "active",
    completedAt: null,
  };

  beforeEach(() => {
    sessionRepository = {
      findById: jest
        .fn()
        .mockResolvedValueOnce(
          activeSession
        )
        .mockResolvedValueOnce({
          ...activeSession,

          status: "completed",

          completedAt: {
            toDate: () =>
              new Date(
                "2026-10-25T20:00:00.000Z"
              ),
          },
        }),

      finalizeSessionWithResults:
        jest.fn().mockResolvedValue({
          ...activeSession,

          status: "completed",

          result: {
            score: 55,
            questionsAnswered: 2,
            totalScore: 110,

            questionsAssigned: 2,
            questionsUnanswered: 0,
            answeredAverageScore: 55,

            completionStatus: "completed",
            rankEligible: true,
          },
        }),

      listResponses: jest.fn().mockResolvedValue([
        {
          questionId: "q1",
          questionPrompt: "Prompt 1",

          evaluation: {
            score: 100,
            isCorrect: true,
            feedback: "Correct.",
          },
        },
        {
          questionId: "q2",
          questionPrompt: "Prompt 2",

          evaluation: {
            score: 10,
            feedback: "Needs work.",
          },
        },
      ]),
    };

    logger = {
      error: jest.fn(),
    };

    service = createSessionResultsService({
      sessionRepository,
      logger,
    });
  });

  test("requires a session repository", () => {
    expect(() =>
      createSessionResultsService({})
    ).toThrow(
      "createSessionResultsService requires sessionRepository."
    );
  });

  test("runs the full pipeline from completion to result", async () => {
    const results =
      await service.completeSession({
        sessionId: "session-1",
        userId: "user-1",
      });

    expect(
      sessionRepository.finalizeSessionWithResults
    ).toHaveBeenCalledWith(
      "session-1",
      "user-1"
    );

    expect(results).toMatchObject({
      id: "session-1",
      status: "completed",

      result: {
        score: 55,
        questionsAnswered: 2,
        totalScore: 110,
      },

      eloChange: "+1",

      completedAt:
        "2026-10-25T20:00:00.000Z",

      breakdownAvailable: true,
    });

    expect(results.breakdown).toEqual([
      {
        questionId: "q1",
        questionPrompt: "Prompt 1",
        score: 100,
        isCorrect: true,
        feedback: "Correct.",
      },
      {
        questionId: "q2",
        questionPrompt: "Prompt 2",
        score: 10,
        isCorrect: null,
        feedback: "Needs work.",
      },
    ]);
  });

  test("rejects missing input before touching the database", async () => {
    await expect(
      service.completeSession({
        sessionId: "",
        userId: "user-1",
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: RESULTS_ERROR_CODES.SESSION_ID_REQUIRED,
    });

    expect(
      sessionRepository.findById
    ).not.toHaveBeenCalled();
  });

  test("returns SESSION_NOT_FOUND when the session does not exist", async () => {
    sessionRepository.findById
      .mockReset()
      .mockResolvedValue(null);

    await expect(
      service.completeSession({
        sessionId: "missing",
        userId: "user-1",
      })
    ).rejects.toMatchObject({
      statusCode: 404,
      code: RESULTS_ERROR_CODES.SESSION_NOT_FOUND,
    });

    expect(
      sessionRepository.finalizeSessionWithResults
    ).not.toHaveBeenCalled();
  });

  test("returns SESSION_FORBIDDEN for another user's session", async () => {
    sessionRepository.findById
      .mockReset()
      .mockResolvedValue({
        ...activeSession,
        userId: "someone-else",
      });

    await expect(
      service.completeSession({
        sessionId: "session-1",
        userId: "user-1",
      })
    ).rejects.toMatchObject({
      statusCode: 403,
      code: RESULTS_ERROR_CODES.SESSION_FORBIDDEN,
    });

    expect(
      sessionRepository.finalizeSessionWithResults
    ).not.toHaveBeenCalled();
  });

  test("maps a non-active session to SESSION_NOT_ACTIVE", async () => {
    sessionRepository.finalizeSessionWithResults
      .mockRejectedValue(
        repositoryError(
          "This session cannot be completed.",
          409
        )
      );

    await expect(
      service.completeSession({
        sessionId: "session-1",
        userId: "user-1",
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: RESULTS_ERROR_CODES.SESSION_NOT_ACTIVE,
    });
  });

  test("maps corrupt saved scores to INVALID_SCORING_DATA", async () => {
    sessionRepository.finalizeSessionWithResults
      .mockRejectedValue(
        repositoryError(
          "Saved responses contain invalid scoring data.",
          409
        )
      );

    await expect(
      service.completeSession({
        sessionId: "session-1",
        userId: "user-1",
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: RESULTS_ERROR_CODES.INVALID_SCORING_DATA,
    });
  });

  test("hides unexpected failures behind a generic 500 and logs them", async () => {
    sessionRepository.finalizeSessionWithResults
      .mockRejectedValue(
        new Error(
          "Firestore deadline exceeded"
        )
      );

    const promise =
      service.completeSession({
        sessionId: "session-1",
        userId: "user-1",
      });

    await expect(
      promise
    ).rejects.toBeInstanceOf(
      ResultsPipelineError
    );

    await expect(
      promise
    ).rejects.toMatchObject({
      statusCode: 500,

      code:
        RESULTS_ERROR_CODES
          .RESULTS_CALCULATION_FAILED,

      message:
        "Unable to calculate session results. Please try again.",
    });

    expect(
      logger.error
    ).toHaveBeenCalledWith(
      expect.stringContaining("session-1"),
      expect.any(Error)
    );
  });

  test("still returns the score when the breakdown cannot be loaded", async () => {
    sessionRepository.listResponses
      .mockRejectedValue(
        new Error("read failed")
      );

    const results =
      await service.completeSession({
        sessionId: "session-1",
        userId: "user-1",
      });

    expect(results.result.score).toBe(55);

    expect(results.breakdown).toEqual([]);

    expect(
      results.breakdownAvailable
    ).toBe(false);

    expect(
      logger.error
    ).toHaveBeenCalled();
  });

  test("handles a session completed with no answers", async () => {
    sessionRepository.finalizeSessionWithResults
      .mockResolvedValue({
        ...activeSession,

        status: "completed",

        result: {
          score: 0,
          questionsAnswered: 0,
          totalScore: 0,

          questionsAssigned: 2,
          questionsUnanswered: 2,
          answeredAverageScore: null,

          completionStatus: "abandoned",
          rankEligible: false,
        },
      });

    sessionRepository.listResponses
      .mockResolvedValue([]);

    const results =
      await service.completeSession({
        sessionId: "session-1",
        userId: "user-1",
      });

    expect(
      results.result.questionsAnswered
    ).toBe(0);

    expect(
      results.breakdown
    ).toEqual([]);

    expect(
      results.eloChange
    ).toBeNull();

    expect(
      results.result.completionStatus
    ).toBe("abandoned");
  });

  test.each([
    [100, "+2"],
    [70, "+2"],
    [69, "+1"],
    [50, "+1"],
    [49, "-2"],
    [0, "-2"],
  ])(
    "score %i gives ELO change %s",
    (score, expected) => {
      expect(
        calculateEloChange(score)
      ).toBe(expected);
    }
  );
});
