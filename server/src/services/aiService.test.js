jest.mock("./providers/anthropicProvider", () => ({
  generateEvaluation: jest.fn(),
}));

const anthropicProvider = require("./providers/anthropicProvider");
const aiService = require("./aiService");

const question = {
  id: "q1",
  mode: "Theoretical Style",
  prompt: "Explain closures.",
  referenceAnswer: "A closure retains access to its lexical scope.",
  gradingCriteria: [
    {
      name: "Accuracy",
      weight: 60,
      description: "Correctly explains lexical scope.",
    },
    {
      name: "Clarity",
      weight: 40,
      description: "Explains the idea clearly.",
    },
  ],
};

const expectedEvaluation = {
  score: 85,
  feedback: "Solid answer.",
  strengths: ["Accurate definition"],
  weaknesses: [],
  suggestions: ["Add an example"],
  criterionResults: [
    {
      name: "Accuracy",
      awardedPoints: 55,
      maxPoints: 60,
      feedback: "Accurate.",
    },
    {
      name: "Clarity",
      awardedPoints: 30,
      maxPoints: 40,
      feedback: "Mostly clear.",
    },
  ],
};

describe("aiService.generateEvaluation", () => {
  const originalProvider = process.env.AI_PROVIDER;
  const originalNodeEnv = process.env.NODE_ENV;

  let consoleWarnSpy;

  beforeEach(() => {
    jest.clearAllMocks();

    process.env.AI_PROVIDER = "anthropic";
    process.env.NODE_ENV = "test";

    consoleWarnSpy = jest
      .spyOn(console, "warn")
      .mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  afterAll(() => {
    if (originalProvider === undefined) {
      delete process.env.AI_PROVIDER;
    } else {
      process.env.AI_PROVIDER = originalProvider;
    }

    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("calls the configured provider through the abstraction", async () => {
    anthropicProvider.generateEvaluation.mockResolvedValue(
      expectedEvaluation
    );

    const result = await aiService.generateEvaluation({
      question,
      candidateResponse: "A closure is...",
    });

    expect(
      anthropicProvider.generateEvaluation
    ).toHaveBeenCalledWith({
      question,
      candidateResponse: "A closure is...",
      gradingCriteria: question.gradingCriteria,
    });

    expect(
      anthropicProvider.generateEvaluation
    ).toHaveBeenCalledTimes(1);

    expect(result).toEqual(expectedEvaluation);
  });

  it("rejects a question that does not contain a valid private rubric", async () => {
    await expect(
      aiService.generateEvaluation({
        question: {
          id: "q2",
          prompt: "Test",
          referenceAnswer: "Reference",
          gradingCriteria: [
            {
              name: "Only",
              weight: 100,
              description: "x",
            },
          ],
        },
        candidateResponse: "Answer",
      })
    ).rejects.toThrow("not configured for AI grading");

    expect(
      anthropicProvider.generateEvaluation
    ).not.toHaveBeenCalled();
  });

  it("throws a clear error for an unknown provider", async () => {
    process.env.AI_PROVIDER = "not-a-real-provider";

    await expect(
      aiService.generateEvaluation({
        question,
        candidateResponse: "test",
      })
    ).rejects.toThrow("Unknown AI_PROVIDER");

    expect(
      anthropicProvider.generateEvaluation
    ).not.toHaveBeenCalled();
  });

  it("retries once after a temporary provider failure and then succeeds", async () => {
    const temporaryError = new Error(
      "Temporary provider failure"
    );

    temporaryError.statusCode = 503;

    anthropicProvider.generateEvaluation
      .mockRejectedValueOnce(temporaryError)
      .mockResolvedValueOnce(expectedEvaluation);

    const result = await aiService.generateEvaluation({
      question,
      candidateResponse: "test",
    });

    expect(
      anthropicProvider.generateEvaluation
    ).toHaveBeenCalledTimes(2);

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "AI evaluation attempt 1 failed: Temporary provider failure"
    );

    expect(result).toEqual(expectedEvaluation);
  });

  it("retries twice and succeeds on the third attempt", async () => {
    const firstError = new Error(
      "First temporary failure"
    );

    firstError.statusCode = 503;

    const secondError = new Error(
      "Second temporary failure"
    );

    secondError.statusCode = 502;

    anthropicProvider.generateEvaluation
      .mockRejectedValueOnce(firstError)
      .mockRejectedValueOnce(secondError)
      .mockResolvedValueOnce(expectedEvaluation);

    const result = await aiService.generateEvaluation({
      question,
      candidateResponse: "test",
    });

    expect(
      anthropicProvider.generateEvaluation
    ).toHaveBeenCalledTimes(3);

    expect(result).toEqual(expectedEvaluation);
  });

  it("returns a controlled error after the initial attempt and two retries fail", async () => {
    const providerError = new Error(
      "Anthropic service unavailable"
    );

    providerError.statusCode = 503;

    anthropicProvider.generateEvaluation.mockRejectedValue(
      providerError
    );

    await expect(
      aiService.generateEvaluation({
        question,
        candidateResponse: "test",
      })
    ).rejects.toThrow(
      "AI evaluation is currently unavailable. Please try again."
    );

    expect(
      anthropicProvider.generateEvaluation
    ).toHaveBeenCalledTimes(3);
  });

  it("retries network failures and returns a controlled error", async () => {
    const networkError = new Error(
      "Network connection failed"
    );

    networkError.code = "ECONNRESET";

    anthropicProvider.generateEvaluation.mockRejectedValue(
      networkError
    );

    await expect(
      aiService.generateEvaluation({
        question,
        candidateResponse: "test",
      })
    ).rejects.toThrow(
      "AI evaluation is currently unavailable. Please try again."
    );

    expect(
      anthropicProvider.generateEvaluation
    ).toHaveBeenCalledTimes(3);
  });

  it("retries timeout failures and returns a controlled error", async () => {
    const timeoutError = new Error(
      "AI provider request timed out"
    );

    timeoutError.code = "ETIMEDOUT";

    anthropicProvider.generateEvaluation.mockRejectedValue(
      timeoutError
    );

    await expect(
      aiService.generateEvaluation({
        question,
        candidateResponse: "test",
      })
    ).rejects.toThrow(
      "AI evaluation is currently unavailable. Please try again."
    );

    expect(
      anthropicProvider.generateEvaluation
    ).toHaveBeenCalledTimes(3);
  });

  it("retries malformed AI response failures", async () => {
    const malformedError = new Error(
      "Anthropic response did not match the expected evaluation shape."
    );

    malformedError.statusCode = 502;

    anthropicProvider.generateEvaluation.mockRejectedValue(
      malformedError
    );

    await expect(
      aiService.generateEvaluation({
        question,
        candidateResponse: "test",
      })
    ).rejects.toThrow(
      "AI evaluation is currently unavailable. Please try again."
    );

    expect(
      anthropicProvider.generateEvaluation
    ).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-recoverable configuration errors", async () => {
    const configurationError = new Error(
      "Anthropic API key is missing from Firestore configuration."
    );

    configurationError.statusCode = 503;

    anthropicProvider.generateEvaluation.mockRejectedValue(
      configurationError
    );

    await expect(
      aiService.generateEvaluation({
        question,
        candidateResponse: "test",
      })
    ).rejects.toThrow(
      "Anthropic API key is missing from Firestore configuration."
    );

    expect(
      anthropicProvider.generateEvaluation
    ).toHaveBeenCalledTimes(1);
  });

  //Checks whether validateRubric() rejects missing reference answers.
  it("rejects questions missing a reference answer", async () => {
    const questionWithoutReference = {
      ...question,
      referenceAnswer: "",
    };

    await expect(
      aiService.generateEvaluation({
        question: questionWithoutReference,
        candidateResponse: "A closure captures variables.",
      })
    ).rejects.toThrow("not configured for AI grading");

    expect(
      anthropicProvider.generateEvaluation
    ).not.toHaveBeenCalled();
  });
});