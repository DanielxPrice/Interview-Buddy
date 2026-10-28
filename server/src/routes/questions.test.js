
const express = require("express");
const request = require("supertest");
const createQuestionRouter = require("./questions");

const fixtures = [
  {
    id: "quiz-1",
    mode: "Quiz Style",
    prompt: "Choose one",
    active: true,
    jobRoles: ["software engineer"],
    experienceLevels: ["Intermediate"],
    tags: ["trees", "bfs"],
    priority: 10,
    options: ["A", "B"],
    correctAnswer: "A",
    explanation: "Because A",
  },
  {
    id: "code-1",
    mode: "Code Style",
    prompt: "Write BFS",
    active: true,
    jobRoles: ["software engineer"],
    experienceLevels: ["Intermediate"],
    tags: ["trees", "bfs"],
    priority: 10,
    referenceAnswer: "Use a queue",
    gradingCriteria: [
      {
        name: "Correctness",
        weight: 100,
      },
    ],
  },
  {
    id: "theory-1",
    mode: "Theoretical Style",
    prompt: "Explain BFS",
    active: true,
    jobRoles: ["backend developer"],
    experienceLevels: ["Experienced"],
    tags: ["trees"],
    priority: 10,
    referenceAnswer: "Breadth-first search",
  },
];

const baseSetup = {
  mode: "Quiz Style",
  jobRole: "software engineer",
  experienceLevel: "Intermediate",
  tags: ["trees"],
  questionCount: 1,
};

function makeSession(overrides = {}) {
  return {
    id: "session-1",
    userId: "user-1",
    status: "active",
    assignmentStatus: "pending",
    assignedQuestionIds: [],
    assignedQuestions: [],
    ...baseSetup,
    ...overrides,
  };
}

function queryFor(session, overrides = {}) {
  return {
    sessionId: session.id,
    mode: session.mode,
    jobRole: session.jobRole,
    experienceLevel: session.experienceLevel,
    tags: session.tags,
    limit: session.questionCount,
    ...overrides,
  };
}

describe("SEC-03 authoritative question retrieval", () => {
  let app;
  let session;
  let sessionRepository;
  let questionRepository;
  let questionQuotaService;

  beforeEach(() => {
    session = makeSession();

    questionRepository = {
      findByMode: jest.fn(
        async (mode) =>
          fixtures.filter(
            (question) =>
              question.mode === mode
          )
      ),
      findById: jest.fn(
        async (id) =>
          fixtures.find(
            (question) => question.id === id
          ) || null
      ),
    };

    questionQuotaService = {
      getStatus: jest.fn().mockResolvedValue({
        remaining: 20,
      }),
      consume: jest.fn().mockResolvedValue({
        remaining: 19,
      }),
    };

    sessionRepository = {
      findById: jest.fn(
        async () => session
      ),
      assignQuestions: jest.fn(
        async ({ questions }) => {
          session = {
            ...session,
            assignmentStatus: "assigned",
            assignedQuestionIds:
              questions.map(
                (question) => question.id
              ),
            assignedQuestions: questions,
          };

          return questions;
        }
      ),
    };

    app = express();
    app.use(express.json());

    app.use((req, _res, next) => {
      req.user = {
        uid: "user-1",
        role: "user",
      };
      next();
    });

    app.use(
      "/api/questions",
      createQuestionRouter({
        questionRepository,
        questionQuotaService,
        sessionRepository,
      })
    );

    app.use((error, _req, res, _next) =>
      res.status(500).json({
        error: error.message,
      })
    );
  });

  test("requires an assignment-capable repository", () => {
    expect(() =>
      createQuestionRouter({
        questionRepository,
        questionQuotaService,
      })
    ).toThrow(/sessionRepository/);
  });

  test.each([
    [
      "Quiz Style",
      "software engineer",
      "Intermediate",
      "quiz-1",
    ],
    [
      "Code Style",
      "software engineer",
      "Intermediate",
      "code-1",
    ],
    [
      "Theoretical Style",
      "backend developer",
      "Experienced",
      "theory-1",
    ],
  ])(
    "assigns only matching %s questions without leaking grading fields",
    async (mode, role, level, id) => {
      session = makeSession({
        mode,
        jobRole: role,
        experienceLevel: level,
      });

      const response = await request(app)
        .get("/api/questions")
        .query(queryFor(session));

      expect(response.status).toBe(200);

      expect(
        response.body.questions.map(
          (question) => question.id
        )
      ).toEqual([id]);

      expect(response.text).not.toMatch(
        /correctAnswer|referenceAnswer|gradingCriteria/
      );

      expect(
        sessionRepository.assignQuestions
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: session.id,
          userId: "user-1",
          setup: expect.objectContaining({
            questionCount: 1,
          }),
        })
      );

      expect(
        questionQuotaService.consume
      ).toHaveBeenCalledTimes(1);
    }
  );

  test("returns saved questions on retry without reselection or quota reservation", async () => {
    const first = await request(app)
      .get("/api/questions")
      .query(queryFor(session));

    expect(first.status).toBe(200);

    questionRepository.findByMode.mockClear();
    questionQuotaService.consume.mockClear();

    const second = await request(app)
      .get("/api/questions")
      .query(queryFor(session));

    expect(second.status).toBe(200);
    expect(second.body.questions).toEqual(
      first.body.questions
    );

    expect(
      questionRepository.findByMode
    ).not.toHaveBeenCalled();

    expect(
      questionQuotaService.consume
    ).not.toHaveBeenCalled();

    expect(
      questionQuotaService.getStatus
    ).toHaveBeenCalledTimes(1);
  });

  test("requires a session ID in every interview mode", async () => {
    for (const mode of [
      "Quiz Style",
      "Code Style",
      "Theoretical Style",
    ]) {
      const response = await request(app)
        .get("/api/questions")
        .query({
          ...queryFor(session),
          mode,
          sessionId: "",
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe(
        "session-id-required"
      );
    }

    expect(
      questionRepository.findByMode
    ).not.toHaveBeenCalled();

    expect(
      questionQuotaService.consume
    ).not.toHaveBeenCalled();
  });

  test.each([
    "invalid session",
    "session/1",
    "x".repeat(129),
  ])(
    "rejects invalid session ID %s",
    async (sessionId) => {
      const response = await request(app)
        .get("/api/questions")
        .query(queryFor(session, {
          sessionId,
        }));

      expect(response.status).toBe(400);
      expect(response.body.code).toBe(
        "invalid-session-id"
      );
    }
  );

  test("rejects missing or unowned sessions before selecting questions", async () => {
    sessionRepository.findById
      .mockResolvedValueOnce(null);

    const missing = await request(app)
      .get("/api/questions")
      .query(queryFor(session));

    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe(
      "SESSION_NOT_FOUND"
    );

    session = makeSession({
      userId: "someone-else",
    });

    const other = await request(app)
      .get("/api/questions")
      .query(queryFor(session));

    expect(other.status).toBe(403);
    expect(other.body.code).toBe(
      "SESSION_FORBIDDEN"
    );

    expect(
      questionRepository.findByMode
    ).not.toHaveBeenCalled();
  });

  test("rejects completed sessions and altered setup before quota changes", async () => {
    session = makeSession({
      status: "completed",
    });

    const completed = await request(app)
      .get("/api/questions")
      .query(queryFor(session));

    expect(completed.status).toBe(409);
    expect(completed.body.code).toBe(
      "SESSION_NOT_ACTIVE"
    );

    session = makeSession();

    for (const modified of [
      { mode: "Code Style" },
      { jobRole: "other role" },
      { tags: "bfs" },
      { limit: 2 },
    ]) {
      const response = await request(app)
        .get("/api/questions")
        .query(queryFor(session, modified));

      expect(response.status).toBe(409);
      expect(response.body.code).toBe(
        "SESSION_SETUP_MISMATCH"
      );
    }

    expect(
      questionQuotaService.consume
    ).not.toHaveBeenCalled();
  });

  test("rejects insufficient questions without charging quota", async () => {
    session = makeSession({
      questionCount: 2,
    });

    const response = await request(app)
      .get("/api/questions")
      .query(queryFor(session));

    expect(response.status).toBe(409);
    expect(response.body.code).toBe(
      "INSUFFICIENT_MATCHING_QUESTIONS"
    );

    expect(
      questionQuotaService.consume
    ).not.toHaveBeenCalled();

    expect(
      sessionRepository.assignQuestions
    ).not.toHaveBeenCalled();
  });

  test("rejects invalid filters and counts", async () => {
    for (const modified of [
      { mode: "Not supported" },
      { tags: "" },
      { experienceLevel: "" },
      { limit: "2abc" },
    ]) {
      const response = await request(app)
        .get("/api/questions")
        .query(queryFor(session, modified));

      expect(response.status).toBe(400);
    }

    expect(
      questionQuotaService.consume
    ).not.toHaveBeenCalled();
  });

  test("returns 429 when the daily AI quota is exceeded", async () => {
    session = makeSession({
      mode: "Code Style",
    });

    const error = new Error(
      "Daily question limit exceeded."
    );

    Object.assign(error, {
      code: "daily-question-limit-exceeded",
      limit: 20,
      used: 20,
      requested: 1,
      remaining: 0,
    });

    questionQuotaService.consume
      .mockRejectedValue(error);

    const response = await request(app)
      .get("/api/questions")
      .query(queryFor(session));

    expect(response.status).toBe(429);
    expect(response.body.code).toBe(
      "daily-question-limit-exceeded"
    );

    expect(
      sessionRepository.assignQuestions
    ).not.toHaveBeenCalled();
  });

  test("returns 409 for a conflicting quota reservation", async () => {
    session = makeSession({
      mode: "Code Style",
    });

    const error = new Error(
      "Reservation conflict."
    );

    error.code =
      "question-reservation-conflict";

    questionQuotaService.consume
      .mockRejectedValue(error);

    const response = await request(app)
      .get("/api/questions")
      .query(queryFor(session));

    expect(response.status).toBe(409);
    expect(response.body.code).toBe(
      "question-reservation-conflict"
    );

    expect(
      sessionRepository.assignQuestions
    ).not.toHaveBeenCalled();
  });

  test("reserves quota with a stable session fingerprint", async () => {
    session = makeSession({
      mode: "Code Style",
    });

    const response = await request(app)
      .get("/api/questions")
      .query(queryFor(session));

    expect(response.status).toBe(200);

    expect(
      questionQuotaService.consume
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: "user-1",
        mode: "Code Style",
        count: 1,
        reservationId: "session-1",
        reservationFingerprint:
          expect.stringMatching(
            /^[a-f0-9]{64}$/
          ),
      })
    );
  });

  test("count endpoint remains read-only and cached", async () => {
    const query = {
      mode: "Quiz Style",
      jobRole: "software engineer",
      experienceLevel: "Intermediate",
      tags: "trees",
    };

    const first = await request(app)
      .get("/api/questions/count")
      .query(query);

    const second = await request(app)
      .get("/api/questions/count")
      .query({
        ...query,
        tags: "bfs",
      });

    expect(first.body).toEqual({
      availableCount: 1,
    });

    expect(second.body).toEqual({
      availableCount: 1,
    });

    expect(
      questionRepository.findByMode
    ).toHaveBeenCalledTimes(1);

    expect(
      sessionRepository.assignQuestions
    ).not.toHaveBeenCalled();

    expect(
      questionQuotaService.consume
    ).not.toHaveBeenCalled();
  });

  test("metadata and setup options remain compatible", async () => {
    const metadataService = {
      getVersion:
        jest.fn().mockResolvedValue(4),
      getMetadata:
        jest.fn().mockResolvedValue({
          version: 4,
          modes: {},
        }),
    };

    const compatibleApp = express();

    compatibleApp.use((req, _res, next) => {
      req.user = {
        uid: "user-1",
        role: "user",
      };
      next();
    });

    compatibleApp.use(
      "/api/questions",
      createQuestionRouter({
        questionRepository,
        questionQuotaService,
        sessionRepository,
        questionMetadataService:
          metadataService,
      })
    );

    const version = await request(
      compatibleApp
    ).get("/api/questions/metadata/version");

    const metadata = await request(
      compatibleApp
    ).get("/api/questions/metadata");

    const options = await request(
      compatibleApp
    )
      .get("/api/questions/options")
      .query({
        mode: "Quiz Style",
      });

    expect(version.body).toEqual({
      version: 4,
    });

    expect(metadata.body.version).toBe(4);

    expect(options.body.jobRoles).toContain(
      "software engineer"
    );

    expect(metadata.text).not.toContain(
      "correctAnswer"
    );
  });

  test("propagates database failures without charging quota", async () => {
    questionRepository.findByMode
      .mockRejectedValue(
        new Error("Firestore unavailable")
      );

    const response = await request(app)
      .get("/api/questions")
      .query(queryFor(session));

    expect(response.status).toBe(500);

    expect(
      questionQuotaService.consume
    ).not.toHaveBeenCalled();
  });
});
