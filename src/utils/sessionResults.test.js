
import {
  END_SESSION_ERROR_MESSAGES,
  buildSessionResult,
  calculateEloChange,
  formatCompletedDate,
  getEndSessionErrorMessage,
  isRetryableEndSessionError,
} from "./sessionResults";

function serviceError(code, status) {
  const error = new Error("raw server message");
  error.code = code;
  error.status = status;
  return error;
}

describe("getEndSessionErrorMessage", () => {
  test.each(
    Object.keys(END_SESSION_ERROR_MESSAGES)
  )("maps %s to its friendly message", (code) => {
    expect(
      getEndSessionErrorMessage(
        serviceError(code, 400)
      )
    ).toBe(END_SESSION_ERROR_MESSAGES[code]);
  });

  test("never shows the raw server message", () => {
    expect(
      getEndSessionErrorMessage(
        serviceError("SESSION_NOT_FOUND", 404)
      )
    ).not.toContain("raw server message");
  });

  test("explains network failures", () => {
    expect(
      getEndSessionErrorMessage(
        new TypeError("Failed to fetch")
      )
    ).toBe(
      "Could not reach the server. Check your connection and try again."
    );
  });

  test("falls back to a generic message for unknown errors", () => {
    expect(
      getEndSessionErrorMessage(
        serviceError("SOMETHING_NEW", 500)
      )
    ).toBe(
      "Unable to complete the interview session. Please try again."
    );
  });
});

describe("isRetryableEndSessionError", () => {
  test.each([
    ["SESSION_NOT_FOUND", false],
    ["SESSION_FORBIDDEN", false],
    ["SESSION_NOT_ACTIVE", false],
    ["SESSION_ID_REQUIRED", false],
    ["SESSION_ASSIGNMENT_INVALID", false],
    ["INVALID_SCORING_DATA", true],
    ["RESULTS_CALCULATION_FAILED", true],
    [undefined, true],
  ])("%s retryable: %s", (code, expected) => {
    expect(
      isRetryableEndSessionError({ code })
    ).toBe(expected);
  });
});

describe("buildSessionResult", () => {
  const setupData = {
    id: "session-1",
    jobRole: "Software Engineer",
    experienceLevel: "Intermediate",
    tags: ["algorithms"],
  };

  const answeredQuestions = [
    {
      questionId: "q1",
      question: "Local prompt 1",
      userAnswer: "Queue",
      score: 100,
      isCorrect: true,
      feedback: "Local feedback",
    },
    {
      questionId: "q2",
      question: "Local prompt 2",
      userAnswer: "My essay",
      score: 40,
      isCorrect: false,
      strengths: ["Clear"],
    },
  ];

  test("uses the server's score, ELO, date and breakdown", () => {
    const result = buildSessionResult({
      mode: "Quiz Style",
      setupData,
      answeredQuestions,

      savedSession: {
        id: "session-1",

        completedAt:
          "2026-10-25T20:00:00.000Z",

        result: {
          score: 85,
          questionsAnswered: 2,
          totalScore: 170,

          questionsAssigned: 2,
          questionsUnanswered: 0,

          completionStatus: "completed",
          rankEligible: true,
        },

        eloChange: "+2",
        breakdownAvailable: true,

        breakdown: [
          {
            questionId: "q1",
            questionPrompt: "Server prompt 1",
            score: 100,
            isCorrect: true,
            feedback: "Server feedback",
          },
          {
            questionId: "q2",
            questionPrompt: "Server prompt 2",
            score: 70,
            isCorrect: null,
            feedback: "",
          },
        ],
      },
    });

    expect(result).toMatchObject({
      sessionId: "session-1",
      mode: "Quiz Style",
      score: "85%",
      eloChange: "+2",
      date: "October 25, 2026",
      questionsAnswered: 2,
      answerSubmitted: true,
      breakdownAvailable: true,
      scoreSource: "server",
      jobRole: "Software Engineer",
    });

    expect(result.perQuestion[0]).toMatchObject({
      prompt: "Server prompt 1",
      feedback: "Server feedback",
      userAnswer: "Queue",
    });

    expect(result.perQuestion[1]).toMatchObject({
      score: 70,
      isCorrect: false,
      userAnswer: "My essay",
      strengths: ["Clear"],
    });
  });

  test("falls back to browser data when the server sends no result", () => {
    const result = buildSessionResult({
      mode: "Quiz Style",
      setupData,
      answeredQuestions,

      savedSession: {
        id: "session-1",
      },
    });

    expect(result.score).toBe("70%");
    expect(result.eloChange).toBeNull();
    expect(result.rankEligible).toBe(false);
    expect(result.scoreSource).toBe("local");

    expect(
      result.perQuestion.map(
        (item) => item.prompt
      )
    ).toEqual([
      "Local prompt 1",
      "Local prompt 2",
    ]);
  });

  test("passes through a breakdown the server could not load", () => {
    const result = buildSessionResult({
      mode: "Quiz Style",
      setupData,
      answeredQuestions: [],

      savedSession: {
        result: {
          score: 60,
          questionsAnswered: 3,
          totalScore: 180,
        },

        eloChange: "+1",
        breakdown: [],
        breakdownAvailable: false,
      },
    });

    expect(result.score).toBe("60%");
    expect(result.questionsAnswered).toBe(3);

    expect(result.breakdownAvailable).toBe(false);
  });

  test("handles a session ended with no answers", () => {
    const result = buildSessionResult({
      mode: "Quiz Style",
      setupData,
      answeredQuestions: [],

      savedSession: {
        result: {
          score: 0,
          questionsAnswered: 0,
          totalScore: 0,
        },

        eloChange: "-2",
        breakdown: [],
      },
    });

    expect(result).toMatchObject({
      score: "0%",
      questionsAnswered: 0,
      answerSubmitted: false,
      perQuestion: [],
    });
  });
});

describe("formatCompletedDate", () => {
  test("formats an ISO date", () => {
    expect(
      formatCompletedDate(
        "2026-10-25T20:00:00.000Z"
      )
    ).toBe("October 25, 2026");
  });

  test("returns Unknown date for garbage input", () => {
    expect(
      formatCompletedDate("not a date")
    ).toBe("Unknown date");
  });
});

describe("calculateEloChange", () => {
  test.each([
    [70, "+2"],
    [50, "+1"],
    [49, "-2"],
  ])(
    "score %i gives %s",
    (score, expected) => {
      expect(
        calculateEloChange(score)
      ).toBe(expected);
    }
  );
});
