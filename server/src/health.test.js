
const getHealthPayload = require("./health");

describe("health deployment metadata", () => {
  test("contains the source revision and CI build version", () => {
    const sourceCommitSha =
      "0123456789abcdef0123456789abcdef01234567";

    expect(getHealthPayload({
      BUILD_VERSION: "IB-build-35.1-a73bf21",
      SOURCE_COMMIT_SHA: sourceCommitSha,
    })).toEqual({
      status: "ok",
      service: "interview-buddy-api",
      buildVersion: "IB-build-35.1-a73bf21",
      sourceCommitSha: sourceCommitSha,
    });
  });

  test("is safe for local development without CI variables", () => {
    expect(getHealthPayload({})).toEqual({
      status: "ok",
      service: "interview-buddy-api",
      buildVersion: "local",
      sourceCommitSha: "local",
    });
  });
});
