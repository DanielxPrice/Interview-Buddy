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

  test("returns current metadata revision and safe metadata", async () => {
    const { buildQuestionMetadata } = require("../services/questionMetadataBuilder");
    const metadata = buildQuestionMetadata(questionFixtures);
    const metadataService = {
      getVersion: jest.fn().mockResolvedValue(3),
      getMetadata: jest.fn().mockResolvedValue({ version: 3, ...metadata }),
    };
    const safeApp = express();
    safeApp.use((req, res, next) => {
      req.user = { uid: "test-user" };
      next();
    });
    safeApp.use("/api/questions", createQuestionRouter({
      questionRepository, questionQuotaService, questionMetadataService: metadataService,
    }));
    const version = await request(safeApp).get("/api/questions/metadata/version");
    const data = await request(safeApp).get("/api/questions/metadata");
    expect(version.body).toEqual({ version: 3 });
    expect(data.body.modes["Quiz Style"].all.tags).toEqual(["bfs", "trees"]);
    expect(data.text).not.toContain("correctAnswer");
    expect(data.text).not.toContain("referenceAnswer");
    expect(metadataService.getMetadata).toHaveBeenCalledTimes(1);
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
  
  //Question Retrieval Coordination tests
  test.each(["Code Style", "Theoretical Style"])(
    "rejects %s retrieval without a session ID",
    async (mode) => {
      const response = await request(app)
        .get("/api/questions")
        .query({
          mode,
          jobRole: mode === "Code Style"
            ? "software engineer"
            : "backend developer",
          experienceLevel: mode === "Code Style"
            ? "Intermediate"
            : "Experienced",
          tags: "trees",
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("session-id-required");

      expect(questionRepository.findByMode)
        .not.toHaveBeenCalled();

      expect(questionQuotaService.consume)
        .not.toHaveBeenCalled();
    }
  );

  test.each(["invalid session", "session/123", "a".repeat(129)])(
    "rejects an invalid session ID",
    async (sessionId) => {
      const response = await request(app)
        .get("/api/questions")
        .query({
          mode: "Code Style",
          jobRole: "software engineer",
          experienceLevel: "Intermediate",
          tags: "trees",
          sessionId,
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("invalid-session-id");

      expect(questionRepository.findByMode)
        .not.toHaveBeenCalled();

      expect(questionQuotaService.consume)
        .not.toHaveBeenCalled();
    }
  );

  test("returns 429 when daily question quota is exceeded", async () => {
    const quotaError = new Error("Daily question limit exceeded.");

    quotaError.code = "daily-question-limit-exceeded";
    quotaError.limit = 20;
    quotaError.used = 20;
    quotaError.requested = 1;
    quotaError.remaining = 0;

    questionQuotaService.consume.mockRejectedValue(quotaError);

    const response = await request(app)
      .get("/api/questions")
      .query({
        mode: "Code Style",
        jobRole: "software engineer",
        experienceLevel: "Intermediate",
        tags: "trees",
        sessionId: "session-123",
      });

    expect(response.status).toBe(429);
    expect(response.body.code)
      .toBe("daily-question-limit-exceeded");

    expect(response.body.quota).toEqual({
      limit: 20,
      used: 20,
      requested: 1,
      remaining: 0,
    });

    expect(questionQuotaService.consume)
      .toHaveBeenCalledTimes(1);
  });

  test("returns 409 for a conflicting question reservation", async () => {
    const conflictError = new Error(
      "Question reservation conflicts with an existing session."
    );

    conflictError.code = "question-reservation-conflict";

    questionQuotaService.consume.mockRejectedValue(conflictError);

    const response = await request(app)
      .get("/api/questions")
      .query({
        mode: "Code Style",
        jobRole: "software engineer",
        experienceLevel: "Intermediate",
        tags: "trees",
        sessionId: "session-123",
      });

    expect(response.status).toBe(409);
    expect(response.body.code)
      .toBe("question-reservation-conflict");

    expect(questionQuotaService.consume)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          uid: "user-1",
          reservationId: "session-123",
        })
      );
  });

  test("uses a consistent reservation fingerprint for repeated requests", async () => {
    const query = {
      mode: "Code Style",
      jobRole: "software engineer",
      experienceLevel: "Intermediate",
      tags: "trees",
      sessionId: "session-123",
      limit: 10,
    };

    const firstResponse = await request(app)
      .get("/api/questions")
      .query(query);

    const secondResponse = await request(app)
      .get("/api/questions")
      .query(query);

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);

    expect(questionQuotaService.consume)
      .toHaveBeenCalledTimes(2);

    const firstReservation =
      questionQuotaService.consume.mock.calls[0][0];

    const secondReservation =
      questionQuotaService.consume.mock.calls[1][0];

    expect(firstReservation.reservationId)
      .toBe("session-123");

    expect(secondReservation.reservationId)
      .toBe("session-123");

    expect(firstReservation.reservationFingerprint)
      .toBe(secondReservation.reservationFingerprint);

    expect(firstReservation.reservationFingerprint)
      .toMatch(/^[a-f0-9]{64}$/);

    expect(firstReservation.count).toBe(1);
    expect(secondReservation.count).toBe(1);
  });
});
