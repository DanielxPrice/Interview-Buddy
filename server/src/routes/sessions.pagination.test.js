"use strict";

const express = require("express");
const request = require("supertest");
const createSessionRouter = require("./sessions");

function setup() {
  const sessionRepository = {
    createSession: jest.fn().mockResolvedValue({ id: "new-session", status: "active" }),
    listCompletedByUser: jest.fn().mockResolvedValue([]),
    listByUser: jest.fn().mockResolvedValue([]),
    getSessionPage: jest.fn().mockResolvedValue({ sessions: [{ id: "saved-session" }], nextCursor: null }),
  };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { uid: "owner-1" }; next(); });
  app.use("/api/sessions", createSessionRouter({ sessionRepository }));
  app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
  return { app, sessionRepository };
}

describe("SEC-05 session history paging and quota admission", () => {
  test("page requests are bounded and scoped to the authenticated UID", async () => {
    const { app, sessionRepository } = setup();
    const res = await request(app).get("/api/sessions?status=completed&pageSize=25&cursor=saved-session");
    expect(res.status).toBe(200);
    expect(res.body.sessions).toEqual([{ id: "saved-session" }]);
    expect(sessionRepository.getSessionPage).toHaveBeenCalledWith({
      userId: "owner-1", status: "completed", pageSize: 25, cursor: "saved-session",
    });
    expect(sessionRepository.listCompletedByUser).not.toHaveBeenCalled();
  });

  test.each(["0", "51", "999999", "NaN", "1.5", "-2"]) (
    "rejects invalid page size %s without a Firestore read",
    async (pageSize) => {
      const { app, sessionRepository } = setup();
      const res = await request(app).get(`/api/sessions?pageSize=${encodeURIComponent(pageSize)}`);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("SESSION_PAGE_SIZE_INVALID");
      expect(sessionRepository.getSessionPage).not.toHaveBeenCalled();
    }
  );

  test("rejects a cursor without pageSize", async () => {
    const { app, sessionRepository } = setup();
    const res = await request(app).get("/api/sessions?cursor=anything");
    expect(res.status).toBe(400);
    expect(sessionRepository.getSessionPage).not.toHaveBeenCalled();
  });

  test("rejects malformed cursor before accessing Firestore", async () => {
    const { app, sessionRepository } = setup();
    const res = await request(app).get("/api/sessions?pageSize=25&cursor=bad%2Fid");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("SESSION_CURSOR_INVALID");
    expect(sessionRepository.getSessionPage).not.toHaveBeenCalled();
  });

  test("quota errors preserve HTTP 429 rather than becoming HTTP 500", async () => {
    const { app, sessionRepository } = setup();
    sessionRepository.createSession.mockRejectedValue(Object.assign(
      new Error("Daily interview session creation limit reached."),
      { statusCode: 429, code: "DAILY_SESSION_LIMIT_EXCEEDED" }
    ));
    const res = await request(app).post("/api/sessions").send({
      mode: "Quiz Style", jobRole: "Engineer", experienceLevel: "Beginner",
      tags: ["arrays"], questionCount: 2,
    });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("DAILY_SESSION_LIMIT_EXCEEDED");
  });
});
