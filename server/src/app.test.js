/* HTTP-level test of the Express health endpoint, without Firebase credentials. */
jest.mock("./repositories", () => ({
  questionRepository: {},
  evaluationRepository: {},
  userRepository: {},
  questionUsageRepository: {},
  sessionRepository: {},
}));
jest.mock("./routes/questions", () => () => require("express").Router());
jest.mock("./routes/evaluate", () => () => require("express").Router());
jest.mock("./routes/users", () => () => require("express").Router());
jest.mock("./middleware/requireAuth", () => (_req, _res, next) => next());

const app = require("./app");

describe("GET /api/health", () => {
  let server;
  let url;
  const previousVersion = process.env.BUILD_VERSION;
  const previousSha = process.env.SOURCE_COMMIT_SHA;

  beforeAll(async () => {
    server = await new Promise((resolve) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    url = `http://127.0.0.1:${server.address().port}/api/health`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (previousVersion === undefined) delete process.env.BUILD_VERSION;
    else process.env.BUILD_VERSION = previousVersion;
    if (previousSha === undefined) delete process.env.SOURCE_COMMIT_SHA;
    else process.env.SOURCE_COMMIT_SHA = previousSha;
  });

  test("returns a successful JSON response with exact deployed revision", async () => {
    process.env.BUILD_VERSION = "IB-build-9.1-abcdef0";
    process.env.SOURCE_COMMIT_SHA = "abcdef0123456789abcdef0123456789abcdef01";

    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      service: "interview-buddy-api",
      buildVersion: "IB-build-9.1-abcdef0",
      sourceCommitSha: "abcdef0123456789abcdef0123456789abcdef01",
    });
  });
});
