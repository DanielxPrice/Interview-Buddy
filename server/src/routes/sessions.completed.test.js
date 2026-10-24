
const express = require("express");
const request = require("supertest");
const createSessionRouter = require("./sessions");

function makeApp(sessionRepository, userId = "user-A") {
  const app = express();
  app.use(express.json());

  if (userId) {
    app.use((req, _res, next) => {
      req.user = { uid: userId };
      next();
    });
  }

  app.use(
    "/api/sessions",
    createSessionRouter({ sessionRepository })
  );

  app.use((error, _req, res, _next) => {
    res.status(500).json({ error: error.message });
  });

  return app;
}

describe("GET /api/sessions?status=completed", () => {
  let repository;

  beforeEach(() => {
    repository = {
      listByUser: jest.fn().mockResolvedValue([]),
      listCompletedByUser: jest.fn().mockResolvedValue([]),
      findById: jest.fn(),
      createSession: jest.fn(),
      completeSession: jest.fn(),
    };
  });

  test("returns completed records for the authenticated user", async () => {
    const completed = [
      {
        id: "session-1",
        userId: "user-A",
        status: "completed",
      },
    ];

    repository.listCompletedByUser.mockResolvedValue(completed);

    const response = await request(makeApp(repository))
      .get("/api/sessions?status=completed");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(completed);

    expect(repository.listCompletedByUser)
      .toHaveBeenCalledWith("user-A");

    expect(repository.listByUser)
      .not.toHaveBeenCalled();
  });

  test("retains the existing unfiltered sessions endpoint", async () => {
    const response = await request(makeApp(repository))
      .get("/api/sessions");

    expect(response.status).toBe(200);

    expect(repository.listByUser)
      .toHaveBeenCalledWith("user-A");

    expect(repository.listCompletedByUser)
      .not.toHaveBeenCalled();
  });

  test("rejects unsupported filters without querying Firestore", async () => {
    const response = await request(makeApp(repository))
      .get("/api/sessions?status=active");

    expect(response.status).toBe(400);

    expect(response.body.error)
      .toBe("Unsupported session status filter.");

    expect(repository.listCompletedByUser)
      .not.toHaveBeenCalled();

    expect(repository.listByUser)
      .not.toHaveBeenCalled();
  });

  test("requires authentication", async () => {
    const response = await request(makeApp(repository, null))
      .get("/api/sessions?status=completed");

    expect(response.status).toBe(401);

    expect(repository.listCompletedByUser)
      .not.toHaveBeenCalled();
  });

  test("passes database errors to the centralized error handler", async () => {
    repository.listCompletedByUser.mockRejectedValue(
      new Error("Database unavailable")
    );

    const response = await request(makeApp(repository))
      .get("/api/sessions?status=completed");

    expect(response.status).toBe(500);
    expect(response.body.error).toBe("Database unavailable");
  });
});
