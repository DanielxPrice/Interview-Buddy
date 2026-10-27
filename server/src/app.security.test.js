
const request = require("supertest");
const zlib = require("node:zlib");

// Mock Firebase-backed dependencies.
// These tests must never contact production services.
jest.mock("./repositories", () => ({
  questionRepository: {},
  questionCatalogRepository: {
    getRevision: jest.fn().mockResolvedValue(0),
  },
  evaluationRepository: {},
  userRepository: {},
  questionUsageRepository: {},
  sessionRepository: {},
}));

jest.mock("./routes/questions", () => () =>
  require("express").Router()
);

jest.mock("./routes/evaluate", () => () =>
  require("express").Router()
);

jest.mock("./routes/sessions", () => () =>
  require("express").Router()
);

jest.mock("./routes/accountDeletion", () => () =>
  require("express").Router()
);

jest.mock("./middleware/requireAuth", () =>
  (_req, _res, next) => next()
);

// Create an isolated test-only endpoint.
// This does not exist in the real production application.
jest.mock("./routes/users", () => () => {
  const router = require("express").Router();

  router.post("/__test_echo", (req, res) => {
    res.json({ body: req.body });
  });

  return router;
});

const app = require("./app");

const testPath = "/api/users/__test_echo";

describe("SEC-01 request body parser security", () => {
  test("accepts ordinary uncompressed JSON", async () => {
    const response = await request(app)
      .post(testPath)
      .send({ message: "hello" });

    expect(response.status).toBe(200);

    expect(response.body).toEqual({
      body: { message: "hello" },
    });
  });

  test("rejects compressed JSON without decompressing it", async () => {
    const compressed = zlib.gzipSync(
      Buffer.from(
        JSON.stringify({ message: "hello" })
      )
    );

    const response = await request(app)
      .post(testPath)
      .set("Content-Type", "application/json")
      .set("Content-Encoding", "gzip")
      .send(compressed);

    expect(response.status).toBe(415);
    expect(response.body.code).toBe(
      "UNSUPPORTED_CONTENT_ENCODING"
    );
  });

  test("rejects invalid JSON with 400 rather than 500", async () => {
    const response = await request(app)
      .post(testPath)
      .set("Content-Type", "application/json")
      .send('{"message":');

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("INVALID_JSON");
  });

  test("rejects payloads over 1 MB with 413", async () => {
    const response = await request(app)
      .post(testPath)
      .send({
        message: "a".repeat(1024 * 1024),
      });

    expect(response.status).toBe(413);
    expect(response.body.code).toBe(
      "REQUEST_BODY_TOO_LARGE"
    );
  });

  test("still serves the health endpoint after rejected requests", async () => {
    const response = await request(app)
      .get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
  });
});
