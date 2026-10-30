"use strict";

const express = require("express");
const request = require("supertest");
const createQuestionRouter = require("./questions");
const createSessionRouter = require("./sessions");

function createTestApp() {
  const question = {
    id: "quiz-active",
    mode: "Quiz Style",
    active: true,
    prompt: "Which option is correct?",
    options: ["A", "B", "C"],
    correctAnswer: "B",
    explanation: "Private explanation not available before submission.",
  };

  const questionRepository = {
    findById: jest.fn().mockResolvedValue(question),
    findByMode: jest.fn().mockResolvedValue([question]),
  };

  const questionQuotaService = {
    getStatus: jest.fn().mockResolvedValue({ remaining: 19 }),
    consume: jest.fn(),
  };

  const sessionRepository = {
    findById: jest.fn().mockResolvedValue({
      id: "session-active",
      userId: "user-1",
      status: "active",
      mode: "Quiz Style",
      assignmentStatus: "assigned",
      assignedQuestionIds: ["quiz-active"],
    }),
    assignQuestions: jest.fn(),
    saveQuizAnswer: jest.fn().mockResolvedValue({
      questionId: "quiz-active",
      isCorrect: false,
      explanation: "Private explanation not available before submission.",
    }),
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { uid: "user-1", role: "user" };
    next();
  });
  app.use("/api/questions", createQuestionRouter({
    questionRepository,
    questionQuotaService,
    sessionRepository,
  }));
  app.use("/api/sessions", createSessionRouter({
    sessionRepository,
    questionRepository,
    sessionResultsService: {
      completeSession: jest.fn(),
      getCompletedSessionResults: jest.fn(),
    },
  }));

  return {
    app,
    questionRepository,
    questionQuotaService,
    sessionRepository,
  };
}

describe("SEC-05 S09: retired Quiz answer oracle", () => {
  test.each([
    ["active Quiz question / correct guess", "quiz-active", "B"],
    ["active Quiz question / incorrect guess", "quiz-active", "A"],
    ["inactive Quiz question", "quiz-inactive", "C"],
    ["arbitrary question ID", "not-assigned", "B"],
  ])("legacy check is unavailable for %s", async (_case, questionId, answer) => {
    const f = createTestApp();

    const response = await request(f.app)
      .post(`/api/questions/${questionId}/check`)
      .send({ answer });

    expect(response.status).toBe(404);
    expect(response.text).not.toMatch(/Private explanation|isCorrect|correctAnswer/i);
    expect(f.questionRepository.findById).not.toHaveBeenCalled();
    expect(f.questionRepository.findByMode).not.toHaveBeenCalled();
    expect(f.questionQuotaService.consume).not.toHaveBeenCalled();
    expect(f.sessionRepository.saveQuizAnswer).not.toHaveBeenCalled();
  });

  test("repeated guesses never reveal the answer or read Firestore", async () => {
    const f = createTestApp();

    for (const answer of ["A", "B", "C", "B"]) {
      const response = await request(f.app)
        .post("/api/questions/quiz-active/check")
        .send({ answer });
      expect(response.status).toBe(404);
      expect(response.text).not.toContain("Private explanation");
    }

    expect(f.questionRepository.findById).not.toHaveBeenCalled();
    expect(f.sessionRepository.saveQuizAnswer).not.toHaveBeenCalled();
  });

  test("the legitimate session-bound Quiz submission remains available", async () => {
    const f = createTestApp();

    const response = await request(f.app)
      .post("/api/sessions/session-active/quiz-answers")
      .send({ questionId: "quiz-active", answer: "A" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      questionId: "quiz-active",
      isCorrect: false,
    });
    expect(f.questionRepository.findById).toHaveBeenCalledWith("quiz-active");
    expect(f.sessionRepository.saveQuizAnswer).toHaveBeenCalledWith({
      sessionId: "session-active",
      userId: "user-1",
      question: expect.objectContaining({ id: "quiz-active" }),
      answer: "A",
    });
  });

  test("unassigned Quiz questions are rejected before grading", async () => {
    const f = createTestApp();
    const response = await request(f.app)
      .post("/api/sessions/session-active/quiz-answers")
      .send({ questionId: "quiz-inactive", answer: "A" });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("QUESTION_NOT_ASSIGNED");
    expect(f.questionRepository.findById).not.toHaveBeenCalled();
    expect(f.sessionRepository.saveQuizAnswer).not.toHaveBeenCalled();
  });
});
