
//These three tests are designed to verify that the AI evaluation system can correctly process different
//levels of candidate responses, including strong, partially correct, and incorrect answers.
//Testing how IB processes AI evals, rather than testing Anthropic's AI intelligence.
//anthropicProvider.js prepares eval requests, comms with Anthropic, and processes returned evals
//evaluationContract.js validates evaluation results and calcs the final score using weighted rubric
//We are verifying that these components handle (3) different eval scenarios properly.

//Pipeline: Jest test -> Anthropic Provider (builds request) -> mock response (predetermined score and feedback)
//          -> Evaulation Contract (validates and calcs score).
//Jest checks whether final eval matches expectations
//1. Strong response (95/100)
//2. Partial (55/100)
//3. Incorrect (5/100)
//Verifies calculated score, overall feedback, weaknesses, grading criteria, & provider request call count

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

jest.mock("../config/aiConfig", () => ({
  getAiConfig: jest.fn(),
}));

const { getAiConfig } = require("../config/aiConfig");
const {
  generateEvaluation,
} = require("./providers/anthropicProvider");

// Shared question and weighted grading rubric.
const question = {
  id: "quality-test-1",
  mode: "Theoretical Style",
  topic: "Application Security",
  difficulty: "Beginner",
  prompt:
    "What is the difference between authentication and authorization?",
  referenceAnswer:
    "Authentication verifies user identity. Authorization determines what resources and actions an authenticated user is permitted to access.",
  gradingCriteria: [
    {
      name: "Technical Accuracy",
      weight: 60,
      description:
        "Correctly distinguishes identity verification from permission checking.",
    },
    {
      name: "Completeness",
      weight: 40,
      description:
        "Clearly explains both concepts and provides a relevant example.",
    },
  ],
};

// Mock a structured response from Anthropic.
function mockEvaluation({
  scoreAccuracy,
  scoreCompleteness,
  feedback,
  strengths,
  weaknesses,
  suggestions,
}) {
  mockCreate.mockResolvedValue({
    content: [
      {
        type: "text",
        text: JSON.stringify({
          feedback,
          strengths,
          weaknesses,
          suggestions,
          criterionResults: [
            {
              name: "Technical Accuracy",
              awardedPoints: scoreAccuracy,
              feedback: feedback,
            },
            {
              name: "Completeness",
              awardedPoints: scoreCompleteness,
              feedback: feedback,
            },
          ],
        }),
      },
    ],
  });
}

describe("AI Evaluation - Answer Quality Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    getAiConfig.mockResolvedValue({
      anthropicApiKey: "test-key",
    });
  });

  test("Strong response receives a high-quality evaluation", async () => {
    const candidateResponse = `
      Authentication verifies the identity of a user.
      Authorization determines what resources and
      actions that user is allowed to access.

      For example, logging into an application
      authenticates a user, while checking whether
      they can access an admin dashboard is authorization.
    `;

    mockEvaluation({
      scoreAccuracy: 58,
      scoreCompleteness: 37,
      feedback:
        "Excellent answer demonstrating strong understanding.",
      strengths: [
        "Correctly distinguishes authentication and authorization.",
        "Provides a clear real-world example.",
      ],
      weaknesses: [],
      suggestions: [
        "Could mention role-based access control.",
      ],
    });

    const result = await generateEvaluation({
      question,
      candidateResponse,
      gradingCriteria: question.gradingCriteria,
    });

    expect(result.score).toBe(96);
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.feedback).toContain("Excellent");
    expect(result.strengths.length).toBeGreaterThan(0);
    expect(result.criterionResults).toHaveLength(2);

    expect(result.criterionResults[0].awardedPoints).toBe(60);
    expect(result.criterionResults[1].awardedPoints).toBe(36);

    expect(mockCreate).toHaveBeenCalledTimes(1);

    const prompt = mockCreate.mock.calls[0][0].messages[0].content;

    expect(prompt).toContain(candidateResponse.trim());
    expect(prompt).toContain(question.referenceAnswer);
  });

  test("Partial response receives an intermediate evaluation", async () => {
    const candidateResponse = `
      Authentication is when a user logs into a system
      using their username and password.

      Authorization is related to security and
      controlling access to information.
    `;

    mockEvaluation({
      scoreAccuracy: 35,
      scoreCompleteness: 20,
      feedback:
        "Partially correct but missing important details.",
      strengths: [
        "Recognizes authentication involves identity verification.",
      ],
      weaknesses: [
        "Does not clearly explain authorization.",
        "Missing a practical example.",
      ],
      suggestions: [
        "Explain how permissions differ from identity verification.",
      ],
    });

    const result = await generateEvaluation({
      question,
      candidateResponse,
      gradingCriteria: question.gradingCriteria,
    });

    expect(result.score).toBe(56);
    expect(result.score).toBeGreaterThanOrEqual(40);
    expect(result.score).toBeLessThan(80);

    expect(result.feedback).toContain("Partially correct");
    expect(result.weaknesses.length).toBeGreaterThan(0);
    expect(result.suggestions.length).toBeGreaterThan(0);

    expect(result.criterionResults[0].awardedPoints).toBe(36);
    expect(result.criterionResults[1].awardedPoints).toBe(20);

    expect(mockCreate).toHaveBeenCalledTimes(1);

    const prompt = mockCreate.mock.calls[0][0].messages[0].content;

    expect(prompt).toContain(candidateResponse.trim());
  });

  test("Incorrect response receives a low-quality evaluation", async () => {
    const candidateResponse = `
      Authentication determines which files a
      user can access.

      Authorization checks whether their username
      and password are correct.

      They are basically the same process.
    `;

    mockEvaluation({
      scoreAccuracy: 5,
      scoreCompleteness: 0,
      feedback:
        "Incorrect answer containing major conceptual errors.",
      strengths: [],
      weaknesses: [
        "Reverses the definitions of authentication and authorization.",
        "Incorrectly claims both processes are identical.",
      ],
      suggestions: [
        "Review identity verification and access control concepts.",
      ],
    });

    const result = await generateEvaluation({
      question,
      candidateResponse,
      gradingCriteria: question.gradingCriteria,
    });

    expect(result.score).toBe(6);
    expect(result.score).toBeLessThan(40);

    expect(result.feedback).toContain("Incorrect");
    expect(result.weaknesses.length).toBeGreaterThan(0);
    expect(result.strengths).toHaveLength(0);

    expect(result.criterionResults[0].awardedPoints).toBe(6);
    expect(result.criterionResults[1].awardedPoints).toBe(0);

    expect(mockCreate).toHaveBeenCalledTimes(1);

    const prompt = mockCreate.mock.calls[0][0].messages[0].content;

    expect(prompt).toContain(candidateResponse.trim());
  });
});
