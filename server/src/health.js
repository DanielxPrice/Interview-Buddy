/** Public, non-sensitive deployment traceability for smoke tests. */

function getHealthPayload(env = process.env) {
  return {
    status: "ok",
    service: "interview-buddy-api",
    buildVersion: env.BUILD_VERSION || "local",
    sourceCommitSha: env.SOURCE_COMMIT_SHA || "local",
  };
}

module.exports = getHealthPayload;