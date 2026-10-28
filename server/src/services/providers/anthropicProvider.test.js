const mockCreate = jest.fn();

jest.mock(
  "@anthropic-ai/sdk",
  () =>
    jest.fn().mockImplementation(() => ({
      messages: {
        create: mockCreate,
      },
    })),
  { virtual: true }
);

jest.mock("../../config/aiConfig", () => ({
  getAiConfig: jest.fn(),
}));

const Anthropic = require("@anthropic-ai/sdk");
const { getAiConfig } = require("../../config/aiConfig");
const {
  generateEvaluation,
} = require("./anthropicProvider");

const question = {
  id: "q1",
  mode: "Code Style",
  prompt: "Write a function.",
  referenceAnswer:
    "A correct implementation with an explanation.",
  gradingCriteria: [
    {
      name: "Correctness",
      weight: 60,
      description: "The solution is correct.",
    },
    {
      name: "Explanation",
      weight: 40,
      description:
        "The solution is explained clearly.",
    },
  ],
};

describe("anthropicProvider.generateEvaluation", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    getAiConfig.mockResolvedValue({
      anthropicApiKey: "test-key",
    });
  });

  it("loads the Anthropic API key from AI config", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            feedback: "Good answer.",
            strengths: ["Correct approach"],
            weaknesses: ["Could explain more"],
            suggestions: ["Discuss complexity"],
            criterionResults: [
              {
                name: "Correctness",
                awardedPoints: 55,
                feedback: "Mostly correct.",
              },
              {
                name: "Explanation",
                awardedPoints: 30,
                feedback: "Clear but brief.",
              },
            ],
          }),
        },
      ],
    });

    await generateEvaluation({
      question,
      candidateResponse: "candidate answer",
      gradingCriteria: question.gradingCriteria,
    });

    expect(getAiConfig).toHaveBeenCalledTimes(1);

    expect(Anthropic).toHaveBeenCalledWith({
      apiKey: "test-key",
      maxRetries: 0,
      timeout: 20000,
    });
  });

  it("returns structured feedback and calculates score from rubric points", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            feedback: "Good answer.",
            strengths: ["Correct approach"],
            weaknesses: ["Could explain more"],
            suggestions: ["Discuss complexity"],
            criterionResults: [
              {
                name: "Correctness",
                awardedPoints: 55,
                feedback: "Mostly correct.",
              },
              {
                name: "Explanation",
                awardedPoints: 30,
                feedback: "Clear but brief.",
              },
            ],
          }),
        },
      ],
    });

    const result = await generateEvaluation({
      question,
      candidateResponse: "candidate answer",
      gradingCriteria: question.gradingCriteria,
    });

    expect(result.score).toBe(85);
    expect(result.feedback).toBe("Good answer.");

    expect(result.criterionResults).toEqual([
      {
        name: "Correctness",
        awardedPoints: 55,
        maxPoints: 60,
        feedback: "Mostly correct.",
      },
      {
        name: "Explanation",
        awardedPoints: 30,
        maxPoints: 40,
        feedback: "Clear but brief.",
      },
    ]);
  });

  it("handles JSON wrapped in markdown code fences", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text:
            '```json\n{"feedback":"Decent.","strengths":[],"weaknesses":[],"suggestions":[],"criterionResults":[{"name":"Correctness","awardedPoints":40,"feedback":"ok"},{"name":"Explanation","awardedPoints":20,"feedback":"ok"}]}\n```',
        },
      ],
    });

    const result = await generateEvaluation({
      question,
      candidateResponse: "test",
      gradingCriteria: question.gradingCriteria,
    });

    expect(result.score).toBe(60);
  });

  it("throws when a criterion award exceeds its configured weight", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            feedback: "Invalid",
            strengths: [],
            weaknesses: [],
            suggestions: [],
            criterionResults: [
              {
                name: "Correctness",
                awardedPoints: 80,
                feedback: "too high",
              },
              {
                name: "Explanation",
                awardedPoints: 20,
                feedback: "ok",
              },
            ],
          }),
        },
      ],
    });

    await expect(
      generateEvaluation({
        question,
        candidateResponse: "test",
        gradingCriteria: question.gradingCriteria,
      })
    ).rejects.toMatchObject({
      message:
        "Anthropic response did not match the expected evaluation shape.",
      statusCode: 502,
    });
  });

  it("returns a controlled error for invalid JSON", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: "this is not valid json",
        },
      ],
    });

    await expect(
      generateEvaluation({
        question,
        candidateResponse: "test",
        gradingCriteria: question.gradingCriteria,
      })
    ).rejects.toMatchObject({
      message:
        "Anthropic response did not match the expected evaluation shape.",
      statusCode: 502,
    });
  });

  it("returns a controlled error for an unexpected provider response", async () => {
    mockCreate.mockResolvedValue({
      content: [],
    });

    await expect(
      generateEvaluation({
        question,
        candidateResponse: "test",
        gradingCriteria: question.gradingCriteria,
      })
    ).rejects.toMatchObject({
      message:
        "Anthropic response did not match the expected evaluation shape.",
      statusCode: 502,
    });
  });

  it("rejects structured output missing required overall feedback", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            strengths: [],
            weaknesses: [],
            suggestions: [],
            criterionResults: [
              {
                name: "Correctness",
                awardedPoints: 50,
                feedback: "Good.",
              },
              {
                name: "Explanation",
                awardedPoints: 30,
                feedback: "Clear.",
              },
            ],
          }),
        },
      ],
    });

    await expect(
      generateEvaluation({
        question,
        candidateResponse: "test",
        gradingCriteria: question.gradingCriteria,
      })
    ).rejects.toMatchObject({
      message:
        "Anthropic response did not match the expected evaluation shape.",
      statusCode: 502,
    });
  });

  it("propagates provider network failures as promise rejections", async () => {
    const networkError = new Error(
      "Network unavailable"
    );

    networkError.code = "ECONNRESET";

    mockCreate.mockRejectedValue(networkError);

    await expect(
      generateEvaluation({
        question,
        candidateResponse: "test",
        gradingCriteria: question.gradingCriteria,
      })
    ).rejects.toThrow("Network unavailable");
  });

  it("fails when the Firestore AI configuration cannot be loaded", async () => {
    getAiConfig.mockRejectedValue(
      new Error(
        "Anthropic API key is missing from Firestore configuration."
      )
    );

    await expect(
      generateEvaluation({
        question,
        candidateResponse: "test",
        gradingCriteria: question.gradingCriteria,
      })
    ).rejects.toThrow(
      "Anthropic API key is missing from Firestore configuration."
    );

    expect(mockCreate).not.toHaveBeenCalled();
  });

  //Checks contents of the prompt sent to the provider
  //Checks evaluaion package, rubric correctness, config and fail handling
  //Uses mocked provider, DOES NOT consume paid tokens
  const mockSuccessfulEvaluation = () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            feedback: "Good answer.",
            strengths: ["Correct approach"],
            weaknesses: [],
            suggestions: [],
            criterionResults: [
              {
                name: "Correctness",
                awardedPoints: 55,
                feedback: "Mostly correct.",
              },
              {
                name: "Explanation",
                awardedPoints: 35,
                feedback: "Clear explanation.",
              },
            ],
          }),
        },
      ],
    });
  };

  it("includes the question, candidate answer, and private reference answer in the evaluation package", async () => {
    mockSuccessfulEvaluation();

    const candidateResponse = "My proposed implementation.";

    await generateEvaluation({
      question,
      candidateResponse,
      gradingCriteria: question.gradingCriteria,
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);

    const request = mockCreate.mock.calls[0][0];
    const prompt = request.messages[0].content;

    expect(prompt).toContain(question.prompt);
    expect(prompt).toContain(candidateResponse);
    expect(prompt).toContain(question.referenceAnswer);

    expect(prompt).toContain("QUESTION");
    expect(prompt).toContain("CANDIDATE RESPONSE");
    expect(prompt).toContain("PRIVATE REFERENCE ANSWER");
  });

  it("includes the weighted grading rubric in the evaluation package", async () => {
    mockSuccessfulEvaluation();

    await generateEvaluation({
      question,
      candidateResponse: "A working implementation.",
      gradingCriteria: question.gradingCriteria,
    });

    const request = mockCreate.mock.calls[0][0];
    const prompt = request.messages[0].content;

    expect(prompt).toContain("WEIGHTED GRADING RUBRIC");

    expect(prompt).toContain("Correctness");
    expect(prompt).toContain("Explanation");

    expect(prompt).toContain("60");
    expect(prompt).toContain("40");

    expect(prompt).toContain("The solution is correct.");
    expect(prompt).toContain(
      "The solution is explained clearly."
    );
  });

  it("includes question-specific evaluation instructions", async () => {
    mockSuccessfulEvaluation();

    const questionWithInstructions = {
      ...question,
      evaluationInstructions:
        "Award credit for any valid iterative solution.",
    };

    await generateEvaluation({
      question: questionWithInstructions,
      candidateResponse: "An iterative solution.",
      gradingCriteria: questionWithInstructions.gradingCriteria,
    });

    const request = mockCreate.mock.calls[0][0];
    const prompt = request.messages[0].content;

    expect(prompt).toContain(
      "Award credit for any valid iterative solution."
    );
  });

  it("sends the evaluation package using the configured Anthropic request structure", async () => {
    mockSuccessfulEvaluation();

    await generateEvaluation({
      question,
      candidateResponse: "Candidate solution.",
      gradingCriteria: question.gradingCriteria,
    });

    expect(mockCreate).toHaveBeenCalledWith({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
      max_tokens: 1200,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: expect.any(String),
        },
      ],
    });
  });

  it("does not send a provider request when AI configuration fails", async () => {
    getAiConfig.mockRejectedValue(
      new Error("AI configuration unavailable.")
    );

    await expect(
      generateEvaluation({
        question,
        candidateResponse: "Candidate answer.",
        gradingCriteria: question.gradingCriteria,
      })
    ).rejects.toThrow("AI configuration unavailable.");

    expect(mockCreate).not.toHaveBeenCalled();
  });
});