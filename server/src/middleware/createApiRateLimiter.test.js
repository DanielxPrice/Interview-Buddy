"use strict";

const express = require("express");
const request = require("supertest");
const createApiRateLimiter = require("./createApiRateLimiter");

function fixture({ identity = "user-1" } = {}) {
  const repository = { consume: jest.fn().mockResolvedValue({ allowed: true, remaining: 15 }) };
  const app = express();
  app.use((req, _res, next) => {
    if (identity) req.user = { uid: identity };
    next();
  });
  const limiter = createApiRateLimiter({ rateLimitRepository: repository });
  for (const route of ["questions", "evaluate", "sessions", "users"]) {
    const router = express.Router();
    router.use((_req, res) => res.json({ ok: true }));
    app.use(`/api/${route}`, limiter, router);
  }
  return { app, repository };
}

describe("SEC-05 API rate-limit middleware", () => {
  test("charges server-selected global and category buckets", async () => {
    const f = fixture();
    await request(f.app).get("/api/questions/options").expect(200);
    expect(f.repository.consume).toHaveBeenLastCalledWith({
      userId: "user-1", buckets: ["global", "questions"],
    });
    await request(f.app).post("/api/evaluate").expect(200);
    expect(f.repository.consume).toHaveBeenLastCalledWith({
      userId: "user-1", buckets: ["global", "evaluations"],
    });
    await request(f.app).get("/api/sessions").expect(200);
    expect(f.repository.consume).toHaveBeenLastCalledWith({
      userId: "user-1", buckets: ["global"],
    });
    await request(f.app).post("/api/sessions").expect(200);
    expect(f.repository.consume).toHaveBeenLastCalledWith({
      userId: "user-1", buckets: ["global", "sessionWrites"],
    });
    await request(f.app).patch("/api/users/profile").expect(200);
    expect(f.repository.consume).toHaveBeenLastCalledWith({
      userId: "user-1", buckets: ["global", "users"],
    });
  });

  test("429 includes stable code and Retry-After, and does not pass to route", async () => {
    const f = fixture();
    f.repository.consume.mockResolvedValue({
      allowed: false, retryAfterSeconds: 27, bucket: "global", limit: 120,
    });
    const response = await request(f.app).get("/api/questions").expect(429);
    expect(response.body).toMatchObject({ code: "API_RATE_LIMIT_EXCEEDED", retryAfterSeconds: 27 });
    expect(response.headers["retry-after"]).toBe("27");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).not.toHaveProperty("ok");
  });

  test("Firestore errors fail closed with 503, not a bypass", async () => {
    const f = fixture();
    f.repository.consume.mockRejectedValue(new Error("Firestore unavailable"));
    const response = await request(f.app).get("/api/questions").expect(503);
    expect(response.body.code).toBe("API_RATE_LIMIT_UNAVAILABLE");
    expect(response.body).not.toHaveProperty("ok");
  });

  test("missing authenticated user gets 401 before any database read", async () => {
    const f = fixture({ identity: null });
    const response = await request(f.app).post("/api/evaluate").expect(401);
    expect(response.body.code).toBe("auth-token-required");
    expect(f.repository.consume).not.toHaveBeenCalled();
  });

  test("invalid repository decision fails closed", async () => {
    const f = fixture();
    f.repository.consume.mockResolvedValue({});
    const response = await request(f.app).post("/api/evaluate").expect(503);
    expect(response.body.code).toBe("API_RATE_LIMIT_UNAVAILABLE");
  });

  test("refuses to initialize without a repository", () => {
    expect(() => createApiRateLimiter({})).toThrow(/rateLimitRepository/);
  });
});
