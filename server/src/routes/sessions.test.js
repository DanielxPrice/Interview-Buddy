
const express = require("express");
const request = require("supertest");
const createSessionRouter = require("./sessions");

//Will not write to Firestore, just using mocked repo
describe("Session routes", () => {
  let app;
  let sessionRepository;

  const userId = "test-user-123";

  const mockSession = {
    id: "session-123",
    userId,
    mode: "technical",
    jobRole: "Software Engineer",
    experienceLevel: "entry",
    status: "active",
  };

  beforeEach(() => {
    sessionRepository = {
      createSession: jest.fn(),
      findById: jest.fn(),
      listByUser: jest.fn(),
      completeSession: jest.fn(),
    };

    app = express();
    app.use(express.json());

    // Simulate an authenticated Firebase user.
    app.use((req, res, next) => {
      req.user = { uid: userId };
      next();
    });

    app.use(
      "/api/sessions",
      createSessionRouter({ sessionRepository })
    );

    app.use((err, req, res, next) => {
      res.status(500).json({ error: err.message });
    });
  });

  test("creates a session for the authenticated user", async () => {
    sessionRepository.createSession.mockResolvedValue(mockSession);

    const response = await request(app)
      .post("/api/sessions")
      .send({
        mode: "technical",
        jobRole: "Software Engineer",
        experienceLevel: "entry",
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(mockSession);

    expect(sessionRepository.createSession).toHaveBeenCalledWith({
      userId,
      mode: "technical",
      jobRole: "Software Engineer",
      experienceLevel: "entry",
    });
  });

  test("rejects session creation without a mode", async () => {
    const response = await request(app)
      .post("/api/sessions")
      .send({ jobRole: "Software Engineer" });

    expect(response.status).toBe(400);
    expect(sessionRepository.createSession).not.toHaveBeenCalled();
  });

  test("lists only the authenticated user's sessions", async () => {
    sessionRepository.listByUser.mockResolvedValue([mockSession]);

    const response = await request(app).get("/api/sessions");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([mockSession]);
    expect(sessionRepository.listByUser).toHaveBeenCalledWith(userId);
  });

  test("retrieves a session owned by the user", async () => {
    sessionRepository.findById.mockResolvedValue(mockSession);

    const response = await request(app)
      .get("/api/sessions/session-123");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(mockSession);
  });

  test("returns 404 for a missing session", async () => {
    sessionRepository.findById.mockResolvedValue(null);

    const response = await request(app)
      .get("/api/sessions/missing-session");

    expect(response.status).toBe(404);
  });

  test("prevents access to another user's session", async () => {
    sessionRepository.findById.mockResolvedValue({
      ...mockSession,
      userId: "another-user",
    });

    const response = await request(app)
      .get("/api/sessions/session-123");

    expect(response.status).toBe(403);
  });

  test("completes a session owned by the user", async () => {
    const completedSession = {
      ...mockSession,
      status: "completed",
    };

    sessionRepository.findById.mockResolvedValue(mockSession);
    sessionRepository.completeSession.mockResolvedValue(completedSession);

    const response = await request(app)
      .patch("/api/sessions/session-123/complete");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("completed");

    expect(sessionRepository.completeSession)
      .toHaveBeenCalledWith("session-123");
  });

  test("prevents completing another user's session", async () => {
    sessionRepository.findById.mockResolvedValue({
      ...mockSession,
      userId: "another-user",
    });

    const response = await request(app)
      .patch("/api/sessions/session-123/complete");

    expect(response.status).toBe(403);
    expect(sessionRepository.completeSession).not.toHaveBeenCalled();
  });

  test("returns 404 when completing a missing session", async () => {
    sessionRepository.findById.mockResolvedValue(null);

    const response = await request(app)
      .patch("/api/sessions/missing-session/complete");

    expect(response.status).toBe(404);
    expect(sessionRepository.completeSession).not.toHaveBeenCalled();
  });
});
