const express = require("express");
const request = require("supertest");
const createQuestionRouter = require("./questions");

const questionFixtures = [
  {
    id: "quiz-1", mode: "Quiz Style", prompt: "Choose one", active: true,
    jobRoles: ["software engineer"], experienceLevels: ["Intermediate"],
    tags: ["trees", "bfs"], priority: 10,
    options: ["A", "B"], correctAnswer: "A", explanation: "Because A",
  },
  {
    id: "code-1", mode: "Code Style", prompt: "Write BFS", active: true,
    jobRoles: ["software engineer"], experienceLevels: ["Intermediate"],
    tags: ["trees", "bfs"], priority: 10,
    referenceAnswer: "Use a queue", gradingCriteria: [{ name: "Correctness", weight: 100 }],
  },
  {
    id: "theory-1", mode: "Theoretical Style", prompt: "Explain BFS", active: true,
    jobRoles: ["backend developer"], experienceLevels: ["Experienced"],
    tags: ["trees"], priority: 10,
    referenceAnswer: "Breadth-first search", gradingCriteria: [{ name: "Explanation", weight: 100 }],
  },
];

describe("Question retrieval API H-01 mock integration", () => {
  let app;
  let questionRepository;
  let questionQuotaService;

  beforeEach(() => {
    questionRepository = {
      findByMode: jest.fn(async (mode) => questionFixtures.filter((q) => q.mode === mode)),
      findById: jest.fn(),
    };
    questionQuotaService = {
      getStatus: jest.fn().mockResolvedValue({ remaining: 20 }),
      consume: jest.fn().mockResolvedValue({ remaining: 19 }),
    };
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { uid: "user-1", role: "standard" };
      next();
    });
    app.use("/api/questions", createQuestionRouter({
      questionRepository, questionQuotaService,
    }));
    app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
  });

  test.each([
    ["Quiz Style", "software engineer", "Intermediate", "quiz-1"],
    ["Code Style", "software engineer", "Intermediate", "code-1"],
    ["Theoretical Style", "backend developer", "Experienced", "theory-1"],
  ])("retrieves only %s records matching all setup filters", async (mode, role, level, id) => {
    const response = await request(app).get("/api/questions").query({
      mode,
      jobRole: role,
      experienceLevel: level,
      tags: "trees",
      sessionId: "session-1",
    });
    expect(response.status).toBe(200);
    expect(response.body.questions.map((question) => question.id)).toEqual([id]);
    expect(questionRepository.findByMode).toHaveBeenCalledWith(mode);
    expect(questionQuotaService.consume).toHaveBeenCalledTimes(1);
    expect(response.body.questions[0]).not.toHaveProperty("referenceAnswer");
    expect(response.body.questions[0]).not.toHaveProperty("gradingCriteria");
    expect(response.body.questions[0]).not.toHaveProperty("correctAnswer");
  });

  test("returns 400 for invalid or missing interview modes", async () => {
    for (const mode of ["Not a mode", ""]) {
      const response = await request(app).get("/api/questions").query({ mode });
      expect(response.status).toBe(400);
    }
    expect(questionRepository.findByMode).not.toHaveBeenCalled();
  });

  test("returns 400 for missing filters before repository access", async () => {
    const response = await request(app).get("/api/questions").query({
      mode: "Quiz Style", jobRole: "software engineer", experienceLevel: "Intermediate",
    });
    expect(response.status).toBe(400);
    expect(questionRepository.findByMode).not.toHaveBeenCalled();
  });

  test("returns an empty question set for a valid but unmatched role and tags", async () => {
    const response = await request(app).get("/api/questions").query({
      mode: "Quiz Style", jobRole: "no such role", experienceLevel: "Intermediate",
      tags: "nonexistent-tag",
    });
    expect(response.status).toBe(200);
    expect(response.body.questions).toEqual([]);
    expect(questionQuotaService.consume).toHaveBeenCalledWith(
      expect.objectContaining({ count: 0 })
    );
  });

  test("retrieves mode-specific options from stored active question metadata", async () => {
    const response = await request(app).get("/api/questions/options").query({ mode: "Theoretical Style" });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      jobRoles: ["backend developer"], experienceLevels: ["Experienced"], tags: ["trees"],
    });
    expect(questionRepository.findByMode).toHaveBeenCalledWith("Theoretical Style");
  });

  test("propagates repository read errors through controlled API failure", async () => {
    questionRepository.findByMode.mockRejectedValue(new Error("Firestore unavailable"));
    const response = await request(app).get("/api/questions").query({
      mode: "Quiz Style", jobRole: "software engineer", experienceLevel: "Intermediate",
      tags: "trees",
    });
    expect(response.status).toBe(500);
    expect(response.body.error).toBe("Firestore unavailable");
    expect(questionQuotaService.consume).not.toHaveBeenCalled();
  });
});
