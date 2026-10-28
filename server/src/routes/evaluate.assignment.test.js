
"use strict";

jest.mock("../services/aiService", () => ({
  generateEvaluation: jest.fn(),
}));

const aiService = require("../services/aiService");
const createEvaluateRouter = require("./evaluate");

const QUESTION_ID = "theory-1";
const SESSION_ID = "session-1";
const USER_ID = "owner-1";

function makeSession(overrides = {}) {
  return {
    id: SESSION_ID,
    userId: USER_ID,
    status: "active",
    mode: "Theoretical Style",
    jobRole: "Backend Developer",
    experienceLevel: "Beginner",
    assignmentStatus: "assigned",
    assignedQuestionIds: [QUESTION_ID],
    ...overrides,
  };
}

function makeFixture(overrides = {}) {
  const questionRepository = {
    findById: jest.fn().mockResolvedValue({
      id: QUESTION_ID,
      mode: "Theoretical Style",
      prompt: "Explain dependency injection.",
      active: true,
      referenceAnswer: "Private reference answer",
    }),
  };

  const sessionRepository = {
    findById: jest.fn().mockResolvedValue(
      makeSession(overrides)
    ),
  };

  const evaluationRepository = {
    reserveEvaluation: jest.fn().mockResolvedValue({
      kind: "reserved",
      attemptId: "test-attempt-id",
    }),

    completeReservedEvaluation:
      jest.fn().mockResolvedValue(undefined),

    failReservedEvaluation:
      jest.fn().mockResolvedValue(true),

    markProviderStarted:
      jest.fn().mockResolvedValue(true),

    markUncertainEvaluation:
      jest.fn().mockResolvedValue(true),
  };

  aiService.generateEvaluation.mockResolvedValue({
    score: 80,
    feedback: "Good",
  });

  const router = createEvaluateRouter({
    questionRepository,
    sessionRepository,
    evaluationRepository,
  });

  const handler = router.stack.find(
    (layer) => layer.route?.path === "/"
  ).route.stack[0].handle;

  async function submit(changes = {}) {
    const req = {
      user: {
        uid: USER_ID,
      },
      body: {
        questionId: QUESTION_ID,
        candidateResponse:
          "I would inject dependencies.",
        metadata: {
          sessionId: SESSION_ID,
        },
        ...changes,
      },
    };

    const res = {
      statusCode: 200,
      payload: null,

      status(value) {
        this.statusCode = value;
        return this;
      },

      json(value) {
        this.payload = value;
        return this;
      },
    };

    const next = jest.fn();

    await handler(req, res, next);

    return {
      req,
      res,
      next,
    };
  }

  return {
    submit,
    questionRepository,
    sessionRepository,
    evaluationRepository,
  };
}

describe("SEC-03 AI evaluation admission", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("saves an assigned theoretical answer under the authenticated UID", async () => {
    const f = makeFixture();

    const { res, next } = await f.submit();

    expect(res.statusCode).toBe(200);

    expect(
      res.payload.evaluation.score
    ).toBe(80);

    expect(
      f.evaluationRepository.completeReservedEvaluation
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        sessionId: SESSION_ID,
        questionId: QUESTION_ID,
        mode: "Theoretical Style",
      })
    );

    expect(next).not.toHaveBeenCalled();
  });

  test("supports assigned Code Style questions", async () => {
    const f = makeFixture({
      mode: "Code Style",
    });

    f.questionRepository.findById.mockResolvedValue({
      id: QUESTION_ID,
      mode: "Code Style",
      prompt: "Implement a queue",
      active: true,
    });

    const { res } = await f.submit();

    expect(res.statusCode).toBe(200);

    expect(
      aiService.generateEvaluation
    ).toHaveBeenCalledTimes(1);
  });

  test.each([
    [
      "missing session",
      { metadata: {} },
      400,
      "SESSION_ID_REQUIRED",
    ],
    [
      "blank session",
      {
        metadata: {
          sessionId: "",
        },
      },
      400,
      "SESSION_ID_REQUIRED",
    ],
    [
      "unassigned question",
      {
        questionId: "theory-2",
      },
      409,
      "QUESTION_NOT_ASSIGNED",
    ],
    [
      "invalid question ID",
      {
        questionId: "bad/id",
      },
      400,
      "INVALID_IDENTIFIER",
    ],
  ])(
    "rejects %s without spending an AI call",
    async (_, change, status, code) => {
      const f = makeFixture();

      const { res } = await f.submit(change);

      expect(res.statusCode).toBe(status);
      expect(res.payload.code).toBe(code);

      expect(
        aiService.generateEvaluation
      ).not.toHaveBeenCalled();

      expect(
        f.evaluationRepository.completeReservedEvaluation
      ).not.toHaveBeenCalled();
    }
  );

  test.each([
    [
      {
        userId: "another-user",
      },
      403,
      "SESSION_FORBIDDEN",
    ],
    [
      {
        status: "completed",
      },
      409,
      "SESSION_NOT_ACTIVE",
    ],
    [
      {
        assignmentStatus: "pending",
      },
      409,
      "ASSIGNMENT_NOT_READY",
    ],
    [
      {
        mode: "Quiz Style",
      },
      400,
      "UNSUPPORTED_EVALUATION_MODE",
    ],
  ])(
    "rejects unauthorized session %o before fetching the question",
    async (change, status, code) => {
      const f = makeFixture(change);

      const { res } = await f.submit();

      expect(res.statusCode).toBe(status);
      expect(res.payload.code).toBe(code);

      expect(
        f.questionRepository.findById
      ).not.toHaveBeenCalled();

      expect(
        aiService.generateEvaluation
      ).not.toHaveBeenCalled();
    }
  );

  test("rejects a question whose mode differs from the session", async () => {
    const f = makeFixture();

    f.questionRepository.findById.mockResolvedValue({
      id: QUESTION_ID,
      mode: "Code Style",
      active: true,
    });

    const { res } = await f.submit();

    expect(res.statusCode).toBe(409);

    expect(res.payload.code).toBe(
      "SESSION_MODE_MISMATCH"
    );

    expect(
      aiService.generateEvaluation
    ).not.toHaveBeenCalled();
  });

  test("rejects forged role metadata instead of trusting it", async () => {
    const f = makeFixture();

    const { res } = await f.submit({
      metadata: {
        sessionId: SESSION_ID,
        jobRole: "Different Role",
      },
    });

    expect(res.statusCode).toBe(409);

    expect(res.payload.code).toBe(
      "SESSION_SETUP_MISMATCH"
    );

    expect(
      aiService.generateEvaluation
    ).not.toHaveBeenCalled();
  });
});
