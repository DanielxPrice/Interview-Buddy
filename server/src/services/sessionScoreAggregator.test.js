const {
  aggregateSessionScore,
  resolveQuestionScore,
  scoreFromSteps,
  InvalidScoringDataError,
  DEFAULT_WEIGHT,
} = require("./sessionScoreAggregator");

const answered = (score, extra = {}) => ({ evaluation: { score }, ...extra });

const steps = (...pairs) =>
  pairs.map(([awardedPoints, maxPoints], i) => ({
    name: `Step ${i + 1}`,
    awardedPoints,
    maxPoints,
  }));

describe("aggregateSessionScore - typical sessions", () => {
  test("averages question scores equally by default", () => {
    expect(aggregateSessionScore([answered(100), answered(70)])).toEqual({
      score: 85,
      questionsAnswered: 2,
      totalScore: 170,
    });
  });

  test("handles a mixed quiz session (correct/incorrect)", () => {
    const result = aggregateSessionScore([
      answered(100),
      answered(0),
      answered(100),
      answered(100),
    ]);

    expect(result).toEqual({ score: 75, questionsAnswered: 4, totalScore: 300 });
  });

  test("handles AI-graded sessions with partial-credit scores", () => {
    expect(
      aggregateSessionScore([answered(82), answered(64), answered(91)]).score
    ).toBe(79); // 237 / 3 = 79
  });

  test("a single question becomes the session score", () => {
    expect(aggregateSessionScore([answered(73)]).score).toBe(73);
  });

  test("applies per-question weights", () => {
    // (100*3 + 40*1) / 4 = 85
    const result = aggregateSessionScore([
      answered(100, { weight: 3 }),
      answered(40),
    ]);

    expect(result.score).toBe(85);
    // totalScore stays an unweighted sum for backwards compatibility.
    expect(result.totalScore).toBe(140);
  });

  test("default weight is 1", () => {
    expect(DEFAULT_WEIGHT).toBe(1);
    expect(
      aggregateSessionScore([answered(90, { weight: 1 }), answered(50)]).score
    ).toBe(aggregateSessionScore([answered(90), answered(50)]).score);
  });

  test("derives a question score from step results when score is missing", () => {
    const result = aggregateSessionScore([
      { evaluation: { criterionResults: steps([30, 40], [20, 60]) } }, // 50
      answered(90),
    ]);

    expect(result).toEqual({ score: 70, questionsAnswered: 2, totalScore: 140 });
  });

  test("ignores extra fields on responses and evaluations", () => {
    const result = aggregateSessionScore([
      {
        questionId: "q1",
        mode: "Code Style",
        candidateResponse: "...",
        evaluation: { score: 60, feedback: "ok", strengths: ["x"] },
      },
    ]);

    expect(result.score).toBe(60);
  });
});

describe("aggregateSessionScore - edge cases", () => {
  test("an empty session scores 0", () => {
    expect(aggregateSessionScore([])).toEqual({
      score: 0,
      questionsAnswered: 0,
      totalScore: 0,
    });
  });

  test("all zeros scores 0 and all perfect scores 100", () => {
    expect(aggregateSessionScore([answered(0), answered(0)]).score).toBe(0);
    expect(aggregateSessionScore([answered(100), answered(100)]).score).toBe(
      100
    );
  });

  test("exact halves round up", () => {
    expect(aggregateSessionScore([answered(85), answered(84)]).score).toBe(85); // 84.5
    expect(aggregateSessionScore([answered(0), answered(1)]).score).toBe(1); // 0.5
  });

  test("below a half rounds down", () => {
    // 200 / 3 = 66.67 -> 67, 100 / 3 = 33.33 -> 33
    expect(
      aggregateSessionScore([answered(100), answered(100), answered(0)]).score
    ).toBe(67);
    expect(
      aggregateSessionScore([answered(100), answered(0), answered(0)]).score
    ).toBe(33);
  });

  test("floating point noise does not break half rounding", () => {
    // With weights of 0.1 the raw float mean is 84.49999999999999, which a
    // plain Math.round would turn into 84. The true mean is 84.5 -> 85.
    expect(
      aggregateSessionScore([
        answered(85, { weight: 0.1 }),
        answered(84, { weight: 0.1 }),
      ]).score
    ).toBe(85);
  });

  test("decimal question scores are allowed", () => {
    expect(aggregateSessionScore([answered(72.5)]).score).toBe(73);
  });

  test("a score of 0 is used as-is and is not treated as missing", () => {
    const response = {
      evaluation: { score: 0, criterionResults: steps([40, 40]) },
    };

    expect(aggregateSessionScore([response]).score).toBe(0);
  });

  test("score wins over step results when both are present", () => {
    const response = {
      evaluation: { score: 80, criterionResults: steps([10, 100]) },
    };

    expect(resolveQuestionScore(response)).toBe(80);
  });

  test("a very small positive weight still counts", () => {
    expect(
      aggregateSessionScore([answered(100, { weight: 0.001 })]).score
    ).toBe(100);
  });

  test("large sessions aggregate correctly", () => {
    const responses = Array.from({ length: 1000 }, (_, i) =>
      answered(i % 2 === 0 ? 100 : 50)
    );

    expect(aggregateSessionScore(responses)).toEqual({
      score: 75,
      questionsAnswered: 1000,
      totalScore: 75000,
    });
  });

  test("does not mutate the input", () => {
    const responses = [answered(90, { weight: 2 }), answered(10)];
    const copy = JSON.parse(JSON.stringify(responses));

    aggregateSessionScore(responses);

    expect(responses).toEqual(copy);
  });
});

describe("aggregateSessionScore - invalid data is rejected", () => {
  test.each([
    ["above 100", answered(120)],
    ["negative", answered(-1)],
    ["NaN", answered(NaN)],
    ["Infinity", answered(Infinity)],
    ["a numeric string", answered("90")],
    ["a boolean", answered(true)],
    ["missing evaluation", { questionId: "q1" }],
    ["null response", null],
    ["no score and no steps", { evaluation: { feedback: "x" } }],
    ["empty steps", { evaluation: { criterionResults: [] } }],
    [
      "step awarded above max",
      { evaluation: { criterionResults: steps([50, 40]) } },
    ],
    [
      "negative step points",
      { evaluation: { criterionResults: steps([-5, 40]) } },
    ],
    [
      "zero max points",
      { evaluation: { criterionResults: steps([0, 0]) } },
    ],
    ["zero weight", answered(80, { weight: 0 })],
    ["negative weight", answered(80, { weight: -2 })],
    ["non-numeric weight", answered(80, { weight: "2" })],
  ])("rejects %s", (_label, badResponse) => {
    expect(() => aggregateSessionScore([answered(90), badResponse])).toThrow(
      InvalidScoringDataError
    );
  });

    test("reports which response was invalid", () => {
    let caught;

    try {
      aggregateSessionScore([answered(90), answered(90), answered(500)]);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(InvalidScoringDataError);
    expect(caught.index).toBe(2);
  });

  test("rejects input that is not an array", () => {
    expect(() => aggregateSessionScore(null)).toThrow(InvalidScoringDataError);
    expect(() => aggregateSessionScore({})).toThrow(InvalidScoringDataError);
  });
});

describe("scoreFromSteps", () => {
  test("is awarded / possible on a 0-100 scale", () => {
    expect(scoreFromSteps(steps([40, 40], [30, 60]))).toBe(70);
  });

  test("handles rubric weights that do not total 100", () => {
    expect(scoreFromSteps(steps([1, 2], [2, 2]))).toBe(75);
  });

  test("rounds to one decimal place", () => {
    expect(scoreFromSteps(steps([1, 3]))).toBe(33.3);
  });
});

