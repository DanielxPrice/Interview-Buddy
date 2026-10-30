
const express = require("express");
const request = require("supertest");
const createSessionRouter = require("./sessions");

function buildApp(sessionOverrides = {}) {
  const session = {
    id: "session-1",
    userId: "owner-1",
    mode: "Quiz Style",
    status: "active",
    assignmentStatus: "assigned",
    assignedQuestionIds: ["quiz-1"],
    ...sessionOverrides,
  };

  const sessionRepository = {
    findById: jest.fn().mockResolvedValue(session),
    saveQuizAnswer: jest.fn().mockResolvedValue({
      questionId: "quiz-1",
      isCorrect: true,
      explanation: "Correct.",
    }),
  };

  const questionRepository = {
    findById: jest.fn().mockResolvedValue({
      id: "quiz-1",
      mode: "Quiz Style",
      correctAnswer: "A",
      options: ["A", "B"],
    }),
  };

  const app = express();
  app.use(express.json());

  app.use((req, _res, next) => {
    req.user = { uid: "owner-1" };
    next();
  });

  app.use(
    "/api/sessions",
    createSessionRouter({
      sessionRepository,
      questionRepository,
    })
  );

  app.use((error, _req, res, _next) => {
    res.status(500).json({
      error: error.message,
    });
  });

  return {
    app,
    sessionRepository,
    questionRepository,
  };
}

function submit(
  app,
  questionId = "quiz-1",
  sessionId = "session-1"
) {
  return request(app)
    .post(`/api/sessions/${sessionId}/quiz-answers`)
    .send({
      questionId,
      answer: "A",
    });
}

describe("SEC-03 Quiz submission assignment admission", () => {
  test("accepts an assigned Quiz question for its session owner", async () => {
    const f = buildApp();
    const result = await submit(f.app);

    expect(result.status).toBe(200);
    expect(result.body.isCorrect).toBe(true);

    expect(
      f.sessionRepository.saveQuizAnswer
    ).toHaveBeenCalledWith({
      sessionId: "session-1",
      userId: "owner-1",
      question: expect.objectContaining({
        id: "quiz-1",
      }),
      answer: "A",
    });
  });

  test.each([
    [
      { userId: "another-user" },
      403,
      "SESSION_FORBIDDEN",
    ],
    [
      { status: "completed" },
      409,
      "SESSION_NOT_ACTIVE",
    ],
    [
      { mode: "Code Style" },
      409,
      "SESSION_MODE_MISMATCH",
    ],
    [
      { assignmentStatus: "pending" },
      409,
      "ASSIGNMENT_NOT_READY",
    ],
    [
      { assignedQuestionIds: ["quiz-2"] },
      409,
      "QUESTION_NOT_ASSIGNED",
    ],
  ])(
    "rejects unauthorized session configuration %o before grading",
    async (overrides, status, code) => {
      const f = buildApp(overrides);
      const result = await submit(f.app);

      expect(result.status).toBe(status);
      expect(result.body.code).toBe(code);

      expect(
        f.questionRepository.findById
      ).not.toHaveBeenCalled();

      expect(
        f.sessionRepository.saveQuizAnswer
      ).not.toHaveBeenCalled();
    }
  );

  test("rejects an invalid question ID before Firestore lookups", async () => {
    const f = buildApp();

    const result = await submit(
      f.app,
      "invalid/id"
    );

    expect(result.status).toBe(400);
    expect(result.body.code).toBe(
      "INVALID_IDENTIFIER"
    );

    expect(
      f.sessionRepository.findById
    ).not.toHaveBeenCalled();
  });
});
