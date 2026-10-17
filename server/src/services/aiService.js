// server/src/services/aiService.js
//
// Provider-independent AI evaluation abstraction. Routes and other application
// code depend on this module rather than importing a provider SDK directly.

const anthropicProvider = require("./providers/anthropicProvider");
const { validateRubric } = require("./evaluationContract");

const PROVIDERS = {
  anthropic: anthropicProvider,
  // openai: require("./providers/openaiProvider"),
  // ollama: require("./providers/ollamaProvider"),
};

const MAX_RETRIES = 2;

function getActiveProvider() {
  const activeProviderName = process.env.AI_PROVIDER || "anthropic";
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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelay(retryNumber) {
  if (process.env.NODE_ENV === "test") {
    return 0;
  }

  return 500 * retryNumber;
}

function isRetryableError(error) {
  const message = String(error?.message || "");

  // Configuration problems will not be fixed by retrying.
  if (
    message.includes("AI configuration was not found") ||
    message.includes("Anthropic API key is missing")
  ) {
    return false;
  }

  const rawStatus = error?.statusCode ?? error?.status;

  // Network-style failures may not contain an HTTP status code.
  if (rawStatus === undefined || rawStatus === null) {
    return true;
  }

  const status = Number(rawStatus);

  return [429, 500, 502, 503, 504].includes(status);
}

async function generateWithRetry(provider, params) {
  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await provider.generateEvaluation(params);
    } catch (error) {
      lastError = error;

      if (!isRetryableError(error)) {
        throw error;
      }

      const retriesRemaining = MAX_RETRIES - attempt;

      console.warn(
        `AI evaluation attempt ${attempt + 1} failed: ${error.message}`
      );

      if (retriesRemaining <= 0) {
        break;
      }

      await wait(getRetryDelay(attempt + 1));
    }
  }

  const error = new Error(
    "AI evaluation is currently unavailable. Please try again."
  );

  error.statusCode = lastError?.statusCode || lastError?.status || 502;
  error.cause = lastError;

  throw error;
}

/**
 * Evaluate one interview response through the configured provider.
 *
 * The question object comes from the server-side repository and may contain
 * private grading fields. Those fields never need to be sent to the browser.
 *
 * @param {Object} params
 * @param {Object} params.question
 * @param {string} params.candidateResponse
 * @returns {Promise<{
 *   score: number,
 *   feedback: string,
 *   strengths: string[],
 *   weaknesses: string[],
 *   suggestions: string[],
 *   criterionResults: Array
 * }>}
 */
async function generateEvaluation({ question, candidateResponse } = {}) {
  if (!question) {
    throw new Error("Question is required for AI evaluation.");
  }

  if (!candidateResponse || !String(candidateResponse).trim()) {
    throw new Error("Candidate response is required for AI evaluation.");
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

  return generateWithRetry(provider, {
    question,
    candidateResponse: String(candidateResponse).trim(),
    gradingCriteria: question.gradingCriteria,
  });
}

module.exports = {
  generateEvaluation,
};