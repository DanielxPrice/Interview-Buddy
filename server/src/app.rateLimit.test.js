"use strict";

const request = require("supertest");

const mockConsume = jest.fn();
const mockAuthCalls = jest.fn();
const mockProfileCalls = jest.fn();

jest.mock("./repositories", () => ({
  apiRateLimitRepository: { consume: (...args) => mockConsume(...args) },
  questionRepository: {},
  questionCatalogRepository: { getRevision: jest.fn().mockResolvedValue(0) },
  evaluationRepository: {},
  userRepository: {},
  questionUsageRepository: {},
  sessionRepository: {},
}));

jest.mock("./middleware/requireAuth", () =>
  (req, _res, next) => {
    mockAuthCalls();
    req.user = { uid: "verified-test-uid" };
    next();
  }
);
jest.mock("./middleware/requireAccountReady", () => () =>
  (_req, _res, next) => {
    mockProfileCalls();
    next();
  }
);

jest.mock("./routes/questions", () => () => {
  const router = require("express").Router();
  router.get("/options", (_req, res) => res.json({ passed: "questions" }));
  return router;
});
jest.mock("./routes/evaluate", () => () => {
  const router = require("express").Router();
  router.post("/", (_req, res) => res.json({ passed: "evaluate" }));
  return router;
});
jest.mock("./routes/sessions", () => () => {
  const router = require("express").Router();
  router.post("/", (_req, res) => res.json({ passed: "sessions" }));
  return router;
});
jest.mock("./routes/users", () => () => {
  const router = require("express").Router();
  router.get("/profile", (_req, res) => res.json({ passed: "users" }));
  return router;
});
jest.mock("./routes/accountDeletion", () => () => {
  const router = require("express").Router();
  router.delete("/account", (_req, res) => res.json({ passed: "deletion" }));
  return router;
});

const app = require("./app");

describe("SEC-05 app-wide rate-limit wiring", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConsume.mockResolvedValue({ allowed: true });
  });

  test("health route is public and does not read rate-limit counters", async () => {
    await request(app).get("/api/health").expect(200);
    expect(mockAuthCalls).not.toHaveBeenCalled();
    expect(mockConsume).not.toHaveBeenCalled();
  });

  test("authenticated user charged before profile readiness and routing", async () => {
    const response = await request(app).get("/api/questions/options").expect(200);
    expect(response.body.passed).toBe("questions");
    expect(mockAuthCalls).toHaveBeenCalledTimes(1);
    expect(mockProfileCalls).toHaveBeenCalledTimes(1);
    expect(mockConsume).toHaveBeenCalledWith({
      userId: "verified-test-uid",
      buckets: ["global", "questions"],
    });
    expect(mockAuthCalls.mock.invocationCallOrder[0]).toBeLessThan(mockConsume.mock.invocationCallOrder[0]);
    expect(mockConsume.mock.invocationCallOrder[0]).toBeLessThan(mockProfileCalls.mock.invocationCallOrder[0]);
  });

  test("evaluation and session writes are subject to separate category limits", async () => {
    await request(app).post("/api/evaluate").send({}).expect(200);
    expect(mockConsume).toHaveBeenLastCalledWith({
      userId: "verified-test-uid", buckets: ["global", "evaluations"],
    });
    await request(app).post("/api/sessions").send({}).expect(200);
    expect(mockConsume).toHaveBeenLastCalledWith({
      userId: "verified-test-uid", buckets: ["global", "sessionWrites"],
    });
  });

  test("account deletion crosses the shared user limiter exactly once", async () => {
    const response = await request(app).delete("/api/users/account").expect(200);
    expect(response.body.passed).toBe("deletion");
    expect(mockConsume).toHaveBeenCalledTimes(1);
    expect(mockAuthCalls).toHaveBeenCalledTimes(1);
    expect(mockProfileCalls).toHaveBeenCalledTimes(1);
  });

  test("limit rejection stops route and profile checks", async () => {
    mockConsume.mockResolvedValue({ allowed: false, retryAfterSeconds: 9 });
    const response = await request(app).get("/api/users/profile").expect(429);
    expect(response.body.code).toBe("API_RATE_LIMIT_EXCEEDED");
    expect(mockProfileCalls).not.toHaveBeenCalled();
  });
});
