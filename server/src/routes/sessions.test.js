
const express = require("express");
const request = require("supertest");
const createSessionRouter = require("./sessions");

const TEST_USER_ID = "test-user-123";
const TEST_SESSION_ID = "session-123";

const testSession = {
  id: TEST_SESSION_ID,
  userId: TEST_USER_ID,
  mode: "Quiz Style",
  jobRole: "Software Engineer",
  experienceLevel: "entry",
  status: "active",
  completedAt: null,
};

function createTestApp(
  sessionRepository,
  authenticated = true
) {
  const app = express();
  app.use(express.json());

  // Test-only identity injection.
  // Production uses Firebase requireAuth.
  if (authenticated) {
    app.use((req, res, next) => {
      req.user = {
        uid: TEST_USER_ID,
      };

      next();
    });
  }

  app.use(
    "/api/sessions",
    createSessionRouter({
      sessionRepository,
    })
  );

  app.use((error, req, res, _next) => {
    res.status(500).json({
      error: error.message,
    });
  });

  return app;
}

describe("Session API endpoints", () => {
  let app;
  let sessionRepository;

  beforeEach(() => {
    sessionRepository = {
      createSession: jest.fn(),
      findById: jest.fn(),
      listByUser: jest.fn(),
      finalizeSessionWithResults: jest.fn(),
      listResponses: jest.fn().mockResolvedValue([]),
    };

    app = createTestApp(sessionRepository);
  });

  test("requires a session repository", () => {
    expect(() =>
      createSessionRouter({})
    ).toThrow(
      "createSessionRouter requires sessionRepository."
    );
  });

  test("creates a session with authenticated ownership and trimmed inputs", async () => {
    sessionRepository.createSession.mockResolvedValue(
      testSession
    );

    const response = await request(app)
      .post("/api/sessions")
      .send({
        userId: "forged-user",
        mode: "Quiz Style",
        jobRole: " Software Engineer ",
        experienceLevel: " entry ",
        tags: ["Trees"],
        questionCount: 2,
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(testSession);

    expect(
      sessionRepository.createSession
    ).toHaveBeenCalledWith({
      userId: TEST_USER_ID,
      mode: "Quiz Style",
      jobRole: "Software Engineer",
      experienceLevel: "entry",
      tags: ["trees"],
      questionCount: 2,
    });
  });

  test.each([
    ["missing", undefined],
    ["whitespace-only", "   "],
    ["non-string", 123],
  ])(
    "rejects a %s interview mode",
    async (_label, mode) => {
      const response = await request(app)
        .post("/api/sessions")
        .send({
          mode,
          jobRole: "Software Engineer",
          experienceLevel: "entry",
          tags: ["trees"],
          questionCount: 2,
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(
        /supported interview mode/i
      );

      expect(
        sessionRepository.createSession
      ).not.toHaveBeenCalled();
    }
  );

  test.each([
    [
      "missing job role",
      {
        mode: "Quiz Style",
        experienceLevel: "entry",
        tags: ["trees"],
        questionCount: 2,
      },
    ],
    [
      "blank job role",
      {
        mode: "Quiz Style",
        jobRole: " ",
        experienceLevel: "entry",
        tags: ["trees"],
        questionCount: 2,
      },
    ],
    [
      "missing experience level",
      {
        mode: "Quiz Style",
        jobRole: "Software Engineer",
        tags: ["trees"],
        questionCount: 2,
      },
    ],
    [
      "invalid experience level",
      {
        mode: "Quiz Style",
        jobRole: "Software Engineer",
        experienceLevel: 3,
        tags: ["trees"],
        questionCount: 2,
      },
    ],
  ])("rejects %s", async (_label, body) => {
    const response = await request(app)
      .post("/api/sessions")
      .send(body);

    expect(response.status).toBe(400);

    expect(response.body.error).toMatch(
      /job role and experience level/i
    );

    expect(
      sessionRepository.createSession
    ).not.toHaveBeenCalled();
  });

  test("lists sessions belonging to the authenticated user", async () => {
    sessionRepository.listByUser.mockResolvedValue([
      testSession,
    ]);

    const response = await request(app).get(
      "/api/sessions"
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      testSession,
    ]);

    expect(
      sessionRepository.listByUser
    ).toHaveBeenCalledWith(TEST_USER_ID);
  });

  test("retrieves a session owned by the authenticated user", async () => {
    sessionRepository.findById.mockResolvedValue(
      testSession
    );

    const response = await request(app).get(
      `/api/sessions/${TEST_SESSION_ID}`
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual(testSession);

    expect(
      sessionRepository.findById
    ).toHaveBeenCalledWith(TEST_SESSION_ID);
  });

  test("returns 404 when a requested session does not exist", async () => {
    sessionRepository.findById.mockResolvedValue(
      null
    );

    const response = await request(app).get(
      "/api/sessions/missing-session"
    );

    expect(response.status).toBe(404);
    expect(response.body.error).toBe(
      "Session not found."
    );
  });

  test("rejects access to another user's session", async () => {
    sessionRepository.findById.mockResolvedValue({
      ...testSession,
      userId: "another-user",
    });

    const response = await request(app).get(
      `/api/sessions/${TEST_SESSION_ID}`
    );

    expect(response.status).toBe(403);

    expect(response.body.error).toBe(
      "You do not have access to this session."
    );

    expect(
      sessionRepository.finalizeSessionWithResults
    ).not.toHaveBeenCalled();
  });

  test("completes an existing session owned by the authenticated user", async () => {
    const completedSession = {
      ...testSession,
      status: "completed",
      completedAt: "2026-10-11T00:00:00.000Z",
    };

    sessionRepository.findById.mockResolvedValue(
      testSession
    );

    sessionRepository.finalizeSessionWithResults
      .mockResolvedValue(completedSession);

    const response = await request(app).patch(
      `/api/sessions/${TEST_SESSION_ID}/complete`
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject(
      completedSession
    );

    expect(response.body.breakdown).toEqual([]);

    expect(
      sessionRepository.finalizeSessionWithResults
    ).toHaveBeenCalledWith(
      TEST_SESSION_ID,
      TEST_USER_ID
    );
  });

  test("rejects completion of another user's session", async () => {
    sessionRepository.findById.mockResolvedValue({
      ...testSession,
      userId: "another-user",
    });

    const response = await request(app).patch(
      `/api/sessions/${TEST_SESSION_ID}/complete`
    );

    expect(response.status).toBe(403);

    expect(
      sessionRepository.finalizeSessionWithResults
    ).not.toHaveBeenCalled();
  });

  test("returns 404 when completing an unknown session", async () => {
    sessionRepository.findById.mockResolvedValue(
      null
    );

    const response = await request(app).patch(
      "/api/sessions/missing-session/complete"
    );

    expect(response.status).toBe(404);

    expect(
      sessionRepository.finalizeSessionWithResults
    ).not.toHaveBeenCalled();
  });

  test("returns 404 if the session disappears during completion", async () => {
    sessionRepository.findById.mockResolvedValue(
      testSession
    );

    sessionRepository.finalizeSessionWithResults
      .mockResolvedValue(null);

    const response = await request(app).patch(
      `/api/sessions/${TEST_SESSION_ID}/complete`
    );

    expect(response.status).toBe(404);

    expect(
      sessionRepository.finalizeSessionWithResults
    ).toHaveBeenCalledWith(
      TEST_SESSION_ID,
      TEST_USER_ID
    );
  });

  test("rejects unauthenticated requests", async () => {
    const unauthenticatedApp = createTestApp(
      sessionRepository,
      false
    );

    const response = await request(
      unauthenticatedApp
    ).get("/api/sessions");

    expect(response.status).toBe(401);

    expect(response.body.error).toBe(
      "Authentication is required."
    );

    expect(
      sessionRepository.listByUser
    ).not.toHaveBeenCalled();
  });

  test("forwards repository failures to the error handler", async () => {
    sessionRepository.listByUser.mockRejectedValue(
      new Error("Firestore unavailable.")
    );

    const response = await request(app).get(
      "/api/sessions"
    );

    expect(response.status).toBe(500);

    expect(response.body.error).toBe(
      "Firestore unavailable."
    );
  });
});
