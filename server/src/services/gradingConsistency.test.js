// Grading consistency tests (see GRADING_CONSISTENCY.md).
//
// The AI model itself cannot be unit tested, so these tests cover the parts
// Interview Buddy controls:
//   1. Score bands: similar raw points from the model snap to the same score.
//   2. Prompt: the model is told the allowed values and what each level means,
//      and the request uses temperature 0.
//   3. End to end: two similar evaluations give the same session score and
//      therefore the same ELO change.

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
  SCORE_BANDS,
  snapToBand,
  allowedPoints,
  normalizeEvaluation,
} = require("./evaluationContract");
const { generateEvaluation } = require("./providers/anthropicProvider");
const { aggregateSessionScore } = require("./sessionScoreAggregator");
const { calculateEloUpdate } = require("./eloRating");

// A rubric shaped like the real Code Style questions (70 / 15 / 10 / 5).
const codeRubric = [
  { name: "Core correctness", weight: 70, description: "Correct logic." },
  { name: "Edge cases", weight: 15, description: "Handles edge cases." },
  { name: "Efficiency", weight: 10, description: "Reasonable complexity." },
  { name: "Explanation", weight: 5, description: "Explains the approach." },
];

const question = {
  id: "consistency-1",
  mode: "Code Style",
  topic: "Arrays",
  difficulty: "Beginner",
  prompt: "Return the largest number in an array.",
  referenceAnswer: "Loop through the array and track the maximum value.",
  gradingCriteria: codeRubric,
};

// Build the raw JSON the model would return for the given points.
function rawEvaluation(points) {
  return {
    feedback: "Overall feedback.",
    strengths: ["A strength"],
    weaknesses: ["A weakness"],
    suggestions: ["A suggestion"],
    criterionResults: codeRubric.map((criterion, index) => ({
      name: criterion.name,
      awardedPoints: points[index],
      feedback: `${criterion.name} feedback.`,
    })),
  };
}

function mockModelReturns(points) {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: "text", text: JSON.stringify(rawEvaluation(points)) }],
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  getAiConfig.mockResolvedValue({ anthropicApiKey: "test-key" });
});

describe("score bands", () => {
  test("bands go from 0% to 100% in 10% steps", () => {
    expect(SCORE_BANDS).toEqual([
      0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1,
    ]);
  });

  test("similar raw points on the same criterion snap to the same score", () => {
    // 40, 41 and 44 out of 70 are all closest to 60% (42).
    expect(snapToBand(40, 70)).toBe(42);
    expect(snapToBand(41, 70)).toBe(42);
    expect(snapToBand(44, 70)).toBe(42);
  });

  test("a value already on a band stays the same", () => {
    expect(snapToBand(42, 70)).toBe(42);
    expect(snapToBand(7.5, 15)).toBe(7.5);
  });

  test("an exact tie between two bands rounds up", () => {
    // 30 / 40 = 75%, halfway between 70% (28) and 80% (32).
    expect(snapToBand(30, 40)).toBe(32);
    // 0.5 / 10 = 5%, halfway between 0% and 10%.
    expect(snapToBand(0.5, 10)).toBe(1);
  });

  test("zero and full points stay unchanged", () => {
    expect(snapToBand(0, 70)).toBe(0);
    expect(snapToBand(70, 70)).toBe(70);
  });

  test("allowed points match the bands for each criterion weight", () => {
    expect(allowedPoints(70)).toEqual([
      0, 7, 14, 21, 28, 35, 42, 49, 56, 63, 70,
    ]);
    expect(allowedPoints(15)).toEqual([
      0, 1.5, 3, 4.5, 6, 7.5, 9, 10.5, 12, 13.5, 15,
    ]);
    // Weights stored as strings still work.
    expect(allowedPoints("10")).toEqual(allowedPoints(10));
  });

  test("every snapped value is one of the allowed points", () => {
    for (let raw = 0; raw <= 15; raw += 0.25) {
      expect(allowedPoints(15)).toContain(snapToBand(raw, 15));
    }
  });
});

describe("similar answers get the same evaluation score", () => {
  test("two slightly different raw evaluations normalize to the same score", () => {
    // Same substance, different raw points from the model.
    const first = normalizeEvaluation(rawEvaluation([41, 10, 7, 3]), codeRubric);
    const second = normalizeEvaluation(rawEvaluation([44, 11, 7.4, 3.2]), codeRubric);

    expect(first.score).toBe(second.score);
    expect(first.criterionResults.map((r) => r.awardedPoints)).toEqual(
      second.criterionResults.map((r) => r.awardedPoints)
    );
  });

  test("clearly different answers still get different scores", () => {
    const strong = normalizeEvaluation(rawEvaluation([68, 14, 9, 5]), codeRubric);
    const weak = normalizeEvaluation(rawEvaluation([20, 3, 4, 1]), codeRubric);

    expect(strong.score).toBeGreaterThan(weak.score);
  });

  test("out-of-range points are still rejected, not snapped", () => {
    expect(() =>
      normalizeEvaluation(rawEvaluation([75, 10, 7, 3]), codeRubric)
    ).toThrow(/between 0 and 70/);

    expect(() =>
      normalizeEvaluation(rawEvaluation([-1, 10, 7, 3]), codeRubric)
    ).toThrow(/between 0 and 70/);
  });
});

describe("prompt and request settings", () => {
  async function sentRequest() {
    mockModelReturns([42, 9, 7, 3]);
    await generateEvaluation({
      question,
      candidateResponse: "function max(a) { return Math.max(...a); }",
      gradingCriteria: codeRubric,
    });
    return mockCreate.mock.calls[0][0];
  }

  test("uses temperature 0", async () => {
    const request = await sentRequest();
    expect(request.temperature).toBe(0);
  });

  test("lists the allowed values for every criterion", async () => {
    const prompt = (await sentRequest()).messages[0].content;

    expect(prompt).toContain(
      "Core correctness (70 points; allowed: 0, 7, 14, 21, 28, 35, 42, 49, 56, 63, 70)"
    );
    expect(prompt).toContain(
      "Edge cases (15 points; allowed: 0, 1.5, 3, 4.5, 6, 7.5, 9, 10.5, 12, 13.5, 15)"
    );
  });

  test("defines what each scoring level means", async () => {
    const prompt = (await sentRequest()).messages[0].content;

    expect(prompt).toContain("Award ONLY one of the allowed values");
    expect(prompt).toContain("100% of the points: fully meets the criterion");
    expect(prompt).toContain("50-70%: partly meets the criterion");
    expect(prompt).toContain("0%: missing, irrelevant, or incorrect");
  });

  test("tells the model to grade the same substance the same way", async () => {
    const prompt = (await sentRequest()).messages[0].content;

    expect(prompt).toContain(
      "Responses with the same technical substance must receive the same points"
    );
  });

  test("snaps the model's in-between points end to end", async () => {
    mockModelReturns([44, 11, 7.4, 3.4]);

    const result = await generateEvaluation({
      question,
      candidateResponse: "answer",
      gradingCriteria: codeRubric,
    });

    // 44/70 -> 42, 11/15 -> 10.5, 7.4/10 -> 7, 3.4/5 -> 3.5
    expect(result.criterionResults.map((r) => r.awardedPoints)).toEqual([
      42, 10.5, 7, 3.5,
    ]);
    expect(result.score).toBe(63);
  });
});

describe("impact on ELO", () => {
  test("two sessions with similar answers get the same ELO change", () => {
    // Session A and B answer the same 3 questions with the same substance;
    // the model's raw points differ slightly between the two runs.
    const sessionA = [
      normalizeEvaluation(rawEvaluation([41, 10, 7, 3]), codeRubric),
      normalizeEvaluation(rawEvaluation([62, 13, 9, 4]), codeRubric),
      normalizeEvaluation(rawEvaluation([30, 6, 5, 2]), codeRubric),
    ];
    const sessionB = [
      normalizeEvaluation(rawEvaluation([44, 11, 7.4, 3.2]), codeRubric),
      normalizeEvaluation(rawEvaluation([64, 13.4, 9, 4.2]), codeRubric),
      normalizeEvaluation(rawEvaluation([27, 6.4, 5.2, 2.2]), codeRubric),
    ];

    const scoreA = aggregateSessionScore(
      sessionA.map((evaluation) => ({ evaluation }))
    ).score;
    const scoreB = aggregateSessionScore(
      sessionB.map((evaluation) => ({ evaluation }))
    ).score;

    expect(scoreA).toBe(scoreB);

    const eloA = calculateEloUpdate({ currentElo: 1000, sessionScore: scoreA });
    const eloB = calculateEloUpdate({ currentElo: 1000, sessionScore: scoreB });

    expect(eloA).toEqual(eloB);
  });
});