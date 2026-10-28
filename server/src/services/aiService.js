// server/src/services/aiService.js

const anthropicProvider = require("./providers/anthropicProvider");
const { validateRubric } = require("./evaluationContract");

const PROVIDERS = {
  anthropic: anthropicProvider,
};

// SEC-04:
// No automatic application-level retries.
// A failed network request may still have been billed.
function getActiveProvider() {
  const activeProviderName =
    process.env.AI_PROVIDER || "anthropic";

  const provider = PROVIDERS[activeProviderName];

  if (!provider) {
    throw new Error(
      `Unknown AI_PROVIDER "${activeProviderName}". Available: ${Object.keys(
        PROVIDERS
      ).join(", ")}`
    );
  }

  return provider;
}

/**
 * Generate one AI evaluation.
 *
 * The caller must already have:
 * 1. Verified session ownership.
 * 2. Verified question assignment.
 * 3. Reserved daily evaluation budget.
 * 4. Created the provider-dispatch marker.
 */
async function generateEvaluation({
  question,
  candidateResponse,
} = {}) {
  if (!question) {
    throw new Error(
      "Question is required for AI evaluation."
    );
  }

  if (
    !candidateResponse ||
    !String(candidateResponse).trim()
  ) {
    throw new Error(
      "Candidate response is required for AI evaluation."
    );
  }

  const rubricError = validateRubric(question);

  if (rubricError) {
    const error = new Error(
      `Question ${
        question.id || "unknown"
      } is not configured for AI grading: ${rubricError}`
    );

    error.statusCode = 500;
    throw error;
  }

  const provider = getActiveProvider();

  // ONE provider invocation. No retry loop.
  return provider.generateEvaluation({
    question,
    candidateResponse: String(
      candidateResponse
    ).trim(),
    gradingCriteria: question.gradingCriteria,
  });
}

module.exports = {
  generateEvaluation,
};