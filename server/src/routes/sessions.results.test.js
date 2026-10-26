const express = require("express");
const request = require("supertest");
const createSessionRouter = require("./sessions");

function makeApp(
  { sessionRepository, questionRepository },
  authenticated = true
) {
  const app = express();

  app.use(express.json());

  if (authenticated) {
    app.use((req, _res, next) => {
      req.user = { uid: "user-1" };
      next();
    });
  }

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

  return app;
}

describe("SCRUM-82 results endpoints", () => {
  let sessionRepository;
  let questionRepository;

  beforeEach(() => {
    sessionRepository = {
      findById: jest.fn().mockResolvedValue({
        id: "session-1",
        userId: "user-1",
        status: "active",
      }),

      finalizeSessionWithResults: jest.fn().mockResolvedValue({
        id: "session-1",
        status: "completed",
        result: {
          score: 85,
          questionsAnswered: 2,
          totalScore: 170,
        },
      }),

      listResponses: jest.fn().mockResolvedValue([
        {
          questionId: "quiz-1",
          questionPrompt: "What is 2 + 2?",
          evaluation: { score: 100, isCorrect: true, feedback: "Correct." },
        },
        {
          questionId: "quiz-2",
          questionPrompt: "Pick the sorted list.",
          evaluation: { score: 70, isCorrect: false, feedback: "Close." },
        },
      ]),

      saveQuizAnswer: jest.fn().mockResolvedValue({
        questionId: "quiz-1",
        isCorrect: true,
        explanation: "Correct.",
      }),
    };

    questionRepository = {
      findById: jest.fn().mockResolvedValue({
        id: "quiz-1",
        mode: "Quiz Style",
        correctAnswer: "A",
      }),
    };
  });

  test("persists a Quiz answer under the authenticated session", async () => {
    const response = await request(
      makeApp({ sessionRepository, questionRepository })
    )
      .post("/api/sessions/session-1/quiz-answers")
      .send({
        questionId: "quiz-1",
        answer: "A",
        userId: "forged",
      });

    expect(response.status).toBe(200);
    expect(response.body.isCorrect).toBe(true);

    expect(sessionRepository.saveQuizAnswer).toHaveBeenCalledWith({
      sessionId: "session-1",
      userId: "user-1",
      question: expect.objectContaining({
        id: "quiz-1",
      }),
      answer: "A",
    });
  });

  test("rejects Quiz answer requests without authentication", async () => {
    const response = await request(
      makeApp({ sessionRepository, questionRepository }, false)
    )
      .post("/api/sessions/session-1/quiz-answers")
      .send({
        questionId: "quiz-1",
        answer: "A",
      });

    expect(response.status).toBe(401);

    expect(sessionRepository.saveQuizAnswer).not.toHaveBeenCalled();
  });

  test("rejects a missing Quiz question ID before writing", async () => {
    const response = await request(
      makeApp({ sessionRepository, questionRepository })
    )
      .post("/api/sessions/session-1/quiz-answers")
      .send({
        answer: "A",
      });

    expect(response.status).toBe(400);

    expect(sessionRepository.saveQuizAnswer).not.toHaveBeenCalled();
  });

  test("forwards ownership failures as 403", async () => {
    const error = new Error(
      "You do not have access to this session."
    );

    error.statusCode = 403;

    sessionRepository.saveQuizAnswer.mockRejectedValue(error);

    const response = await request(
      makeApp({ sessionRepository, questionRepository })
    )
      .post("/api/sessions/session-1/quiz-answers")
      .send({
        questionId: "quiz-1",
        answer: "A",
      });

    expect(response.status).toBe(403);
  });

  test("completion responds with the server-calculated result", async () => {
    const response = await request(
      makeApp({ sessionRepository, questionRepository })
    )
      .patch("/api/sessions/session-1/complete");

    expect(response.status).toBe(200);

    expect(response.body.result).toEqual({
      score: 85,
      questionsAnswered: 2,
      totalScore: 170,
    });

    expect(
      sessionRepository.finalizeSessionWithResults
    ).toHaveBeenCalledWith(
      "session-1",
      "user-1"
    );
  });

  test("denies completion of another user's session before finalizing", async () => {
    sessionRepository.findById.mockResolvedValue({
      id: "session-1",
      userId: "other-user",
    });

    const response = await request(
      makeApp({ sessionRepository, questionRepository })
    )
      .patch("/api/sessions/session-1/complete");

    expect(response.status).toBe(403);

    expect(
      sessionRepository.finalizeSessionWithResults
    ).not.toHaveBeenCalled();
  });
  test("completion returns ELO change and per-question breakdown", async () => {
    const response = await request(
      makeApp({ sessionRepository, questionRepository })
    )
      .patch("/api/sessions/session-1/complete");

    expect(response.status).toBe(200);
    expect(response.body.eloChange).toBe("+2");
    expect(response.body.breakdownAvailable).toBe(true);
    expect(response.body.breakdown).toEqual([
      {
        questionId: "quiz-1",
        questionPrompt: "What is 2 + 2?",
        score: 100,
        isCorrect: true,
        feedback: "Correct.",
      },
      {
        questionId: "quiz-2",
        questionPrompt: "Pick the sorted list.",
        score: 70,
        isCorrect: false,
        feedback: "Close.",
      },
    ]);
  });

  test("completion errors include a machine-readable code", async () => {
    const error = new Error("Saved responses contain invalid scoring data.");
    error.statusCode = 409;
    sessionRepository.finalizeSessionWithResults.mockRejectedValue(error);

    const response = await request(
      makeApp({ sessionRepository, questionRepository })
    )
      .patch("/api/sessions/session-1/complete");

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("INVALID_SCORING_DATA");
  });

  test("missing session on completion returns SESSION_NOT_FOUND", async () => {
    sessionRepository.findById.mockResolvedValue(null);

    const response = await request(
      makeApp({ sessionRepository, questionRepository })
    )
      .patch("/api/sessions/session-1/complete");

    expect(response.status).toBe(404);
    expect(response.body.code).toBe("SESSION_NOT_FOUND");
    expect(
      sessionRepository.finalizeSessionWithResults
    ).not.toHaveBeenCalled();
  });
});