
"use strict";

jest.mock("./providers/anthropicProvider", () => ({
  generateEvaluation: jest.fn(),
}));

const anthropicProvider = require("./providers/anthropicProvider");
const aiService = require("./aiService");

const question = {
  id: "q1",
  mode: "Theoretical Style",
  prompt: "Explain closures.",
  referenceAnswer:
    "A closure retains access to lexical scope.",
  gradingCriteria: [
    {
      name: "Accuracy",
      weight: 60,
      description: "Correct lexical scope.",
    },
    {
      name: "Clarity",
      weight: 40,
      description: "Clear explanation.",
    },
  ],
};

const evaluation = {
  score: 90,
  feedback: "Good",
  criterionResults: [],
};

describe("SEC-04 one provider call per evaluation reservation", () => {
  const originalProvider = process.env.AI_PROVIDER;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AI_PROVIDER = "anthropic";
  });

  afterAll(() => {
    if (originalProvider === undefined) {
      delete process.env.AI_PROVIDER;
    } else {
      process.env.AI_PROVIDER = originalProvider;
    }
  });

  test("uses provider exactly once on successful evaluation", async () => {
    anthropicProvider.generateEvaluation.mockResolvedValue(
      evaluation
    );

    await expect(
      aiService.generateEvaluation({
        question,
        candidateResponse: "answer",
      })
    ).resolves.toEqual(evaluation);

    expect(
      anthropicProvider.generateEvaluation
    ).toHaveBeenCalledTimes(1);

    expect(
      anthropicProvider.generateEvaluation
    ).toHaveBeenCalledWith({
      question,
      candidateResponse: "answer",
      gradingCriteria: question.gradingCriteria,
    });
  });

  test.each([
    [
      "timeout",
      Object.assign(new Error("timed out"), {
        code: "ETIMEDOUT",
      }),
    ],
    [
      "network failure",
      Object.assign(new Error("connection reset"), {
        code: "ECONNRESET",
      }),
    ],
    [
      "HTTP 503",
      Object.assign(new Error("unavailable"), {
        statusCode: 503,
      }),
    ],
    [
      "rate limit",
      Object.assign(new Error("rate limit"), {
        statusCode: 429,
      }),
    ],
    [
      "invalid provider response",
      Object.assign(new Error("bad JSON"), {
        statusCode: 502,
      }),
    ],
  ])(
    "does not retry a potentially billed %s",
    async (_label, error) => {
      anthropicProvider.generateEvaluation.mockRejectedValue(
        error
      );

      await expect(
        aiService.generateEvaluation({
          question,
          candidateResponse: "answer",
        })
      ).rejects.toBe(error);

      expect(
        anthropicProvider.generateEvaluation
      ).toHaveBeenCalledTimes(1);
    }
  );

  test("does not call provider for invalid rubric", async () => {
    await expect(
      aiService.generateEvaluation({
        question: {
          ...question,
          referenceAnswer: "",
        },
        candidateResponse: "answer",
      })
    ).rejects.toThrow(
      "not configured for AI grading"
    );

    expect(
      anthropicProvider.generateEvaluation
    ).not.toHaveBeenCalled();
  });

  test("does not call provider for an empty response", async () => {
    await expect(
      aiService.generateEvaluation({
        question,
        candidateResponse: " ",
      })
    ).rejects.toThrow(
      "Candidate response is required"
    );

    expect(
      anthropicProvider.generateEvaluation
    ).not.toHaveBeenCalled();
  });

  test("unknown provider is rejected before network calls", async () => {
    process.env.AI_PROVIDER = "invalid";

    await expect(
      aiService.generateEvaluation({
        question,
        candidateResponse: "answer",
      })
    ).rejects.toThrow("Unknown AI_PROVIDER");

    expect(
      anthropicProvider.generateEvaluation
    ).not.toHaveBeenCalled();
  });
});
