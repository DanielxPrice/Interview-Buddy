
"use strict";

jest.mock("../services/aiService", () => ({
  generateEvaluation: jest.fn(),
}));

const aiService = require("../services/aiService");
const createEvaluateRouter = require("./evaluate");

function fixture() {
  const questionRepository = {
    findById: jest.fn().mockResolvedValue({
      id: "theory-1",
      mode: "Theoretical Style",
      active: true,
      prompt: "Explain queues.",
    }),
  };

  const sessionRepository = {
    findById: jest.fn().mockResolvedValue({
      userId: "user-1",
      status: "active",
      mode: "Theoretical Style",
      assignmentStatus: "assigned",
      assignedQuestionIds: ["theory-1"],
      jobRole: "Backend Developer",
      experienceLevel: "Beginner",
    }),
  };

  const evaluationRepository = {
    reserveEvaluation: jest.fn().mockResolvedValue({
      kind: "reserved",
      attemptId: "server-token",
    }),

    completeReservedEvaluation:
      jest.fn().mockResolvedValue(),

    failReservedEvaluation:
      jest.fn().mockResolvedValue(true),

    markProviderStarted:
      jest.fn().mockResolvedValue(true),

    markUncertainEvaluation:
      jest.fn().mockResolvedValue(true),
  };

  const router = createEvaluateRouter({
    questionRepository,
    sessionRepository,
    evaluationRepository,
  });

  const handler = router.stack.find(
    (x) => x.route?.path === "/"
  ).route.stack[0].handle;

  async function submit(changes = {}) {
    const req = {
      user: {
        uid: "user-1",
      },
      body: {
        requestId: "request-1",
        questionId: "theory-1",
        candidateResponse: "Queue is FIFO.",
        metadata: {
          sessionId: "session-1",
        },
        ...changes,
      },
    };

    const res = {
      statusCode: 200,
      payload: null,

      status(status) {
        this.statusCode = status;
        return this;
      },

      json(payload) {
        this.payload = payload;
        return this;
      },
    };

    const next = jest.fn();

    await handler(req, res, next);

    return {
      res,
      next,
    };
  }

  return {
    submit,
    evaluationRepository,
    questionRepository,
    sessionRepository,
  };
}

describe("SEC-04 AI evaluation reservation admission", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    aiService.generateEvaluation.mockResolvedValue({
      score: 85,
      feedback: "Good",
    });
  });

  test("reserves before AI and completes the matching token", async () => {
    const f = fixture();
    const calls = [];

    f.evaluationRepository.reserveEvaluation
      .mockImplementation(async () => {
        calls.push("reserve");

        return {
          kind: "reserved",
          attemptId: "server-token",
        };
      });

    f.evaluationRepository.markProviderStarted
      .mockImplementation(async () => {
        calls.push("dispatch");
      });

    aiService.generateEvaluation
      .mockImplementation(async () => {
        calls.push("provider");

        return {
          score: 85,
          feedback: "Good",
        };
      });

    f.evaluationRepository.completeReservedEvaluation
      .mockImplementation(async () => {
        calls.push("commit");
      });

    const { res } = await f.submit();

    expect(res.statusCode).toBe(200);

    expect(calls).toEqual([
      "reserve",
      "dispatch",
      "provider",
      "commit",
    ]);

    expect(
      f.evaluationRepository.completeReservedEvaluation
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        sessionId: "session-1",
        questionId: "theory-1",
        attemptId: "server-token",
      })
    );
  });

  test("replay returns saved grade without another provider call", async () => {
    const f = fixture();

    f.evaluationRepository.reserveEvaluation
      .mockResolvedValue({
        kind: "replay",
        evaluation: {
          score: 70,
        },
      });

    const { res } = await f.submit({
      requestId: "another-request",
    });

    expect(res.payload).toMatchObject({
      replayed: true,
      evaluation: {
        score: 70,
      },
    });

    expect(
      aiService.generateEvaluation
    ).not.toHaveBeenCalled();

    expect(
      f.evaluationRepository.completeReservedEvaluation
    ).not.toHaveBeenCalled();

    expect(
      f.evaluationRepository.markProviderStarted
    ).not.toHaveBeenCalled();
  });

  test.each([
    "EVALUATION_IN_PROGRESS",
    "EVALUATION_ATTEMPT_LIMIT",
    "QUESTION_ALREADY_ANSWERED",
  ])(
    "denies %s before provider call",
    async (code) => {
      const f = fixture();

      const error = new Error(
        "Evaluation is unavailable."
      );

      error.code = code;

      error.statusCode =
        code === "EVALUATION_ATTEMPT_LIMIT"
          ? 429
          : 409;

      f.evaluationRepository.reserveEvaluation
        .mockRejectedValue(error);

      const { res } = await f.submit();

      expect(res.statusCode).toBe(
        error.statusCode
      );

      expect(res.payload.code).toBe(code);

      expect(
        aiService.generateEvaluation
      ).not.toHaveBeenCalled();
    }
  );

  test("provider error requires review and does not release the reservation", async () => {
    const f = fixture();

    const error = new Error(
      "AI temporarily unavailable"
    );

    error.statusCode = 503;

    aiService.generateEvaluation
      .mockRejectedValue(error);

    const { res } = await f.submit();

    expect(res.statusCode).toBe(503);

    expect(
      res.payload.code
    ).toBe("EVALUATION_REVIEW_REQUIRED");

    expect(
      f.evaluationRepository.markUncertainEvaluation
    ).toHaveBeenCalledWith({
      userId: "user-1",
      sessionId: "session-1",
      questionId: "theory-1",
      attemptId: "server-token",
    });

    expect(
      f.evaluationRepository.failReservedEvaluation
    ).not.toHaveBeenCalled();

    expect(
      f.evaluationRepository.completeReservedEvaluation
    ).not.toHaveBeenCalled();
  });

  test("uncertain Firestore commit does not release a potentially paid reservation", async () => {
    const f = fixture();

    const error = new Error(
      "Firestore deadline exceeded"
    );

    f.evaluationRepository.completeReservedEvaluation
      .mockRejectedValue(error);

    const { next } = await f.submit();

    expect(next).toHaveBeenCalledWith(error);

    expect(
      f.evaluationRepository.failReservedEvaluation
    ).not.toHaveBeenCalled();
  });

  test("dispatch marker failure prevents calling the AI provider", async () => {
    const f = fixture();

    const error = new Error(
      "Firestore is unavailable"
    );

    f.evaluationRepository.markProviderStarted
      .mockRejectedValue(error);

    const { next } = await f.submit();

    expect(next).toHaveBeenCalledWith(error);

    expect(
      aiService.generateEvaluation
    ).not.toHaveBeenCalled();

    expect(
      f.evaluationRepository.markUncertainEvaluation
    ).not.toHaveBeenCalled();
  });

  test("rejects malformed requestId without creating a reservation", async () => {
    const f = fixture();

    const { res } = await f.submit({
      requestId: "has spaces",
    });

    expect(res.statusCode).toBe(400);

    expect(res.payload.code).toBe(
      "INVALID_REQUEST_ID"
    );

    expect(
      f.evaluationRepository.reserveEvaluation
    ).not.toHaveBeenCalled();
  });

  test("budget errors stop before the provider call and expose a stable error code", async () => {
    const f = fixture();

    const error = new Error(
      "Daily AI evaluation budget reached."
    );

    error.statusCode = 429;
    error.code = "DAILY_EVALUATION_LIMIT_EXCEEDED";

    f.evaluationRepository.reserveEvaluation
      .mockRejectedValue(error);

    const { res } = await f.submit();

    expect(res.statusCode).toBe(429);

    expect(res.payload.code).toBe(
      "DAILY_EVALUATION_LIMIT_EXCEEDED"
    );

    expect(
      aiService.generateEvaluation
    ).not.toHaveBeenCalled();
  });

  test("passes only the server-authenticated role to the budget reservation", async () => {
    const f = fixture();

    await f.submit({
      role: "admin",
    });

    expect(
      f.evaluationRepository.reserveEvaluation
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        role: undefined,
        userId: "user-1",
      })
    );
  });
});
