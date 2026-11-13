// Code Style evaluation tests (see CODE_STYLE_EVALUATION.md).
//
// Covers the readability and code style criterion added to the Code Style
// rubric:
//   1. The rubric itself: weights, criteria and guardrails.
//   2. The seed data: every Code Style question uses the rubric.
//   3. The prompt: the model is told how to grade style.
//   4. Scoring: style changes the score only by the style points, and never
//      makes up for broken code.
//   5. ELO: clean code earns a better rating change than messy code.

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
const { CODE_STYLE_RUBRIC } = require("./codeStyleRubric");
const {
  normalizeEvaluation,
  validateRubric,
} = require("./evaluationContract");
const { generateEvaluation } = require("./providers/anthropicProvider");
const { aggregateSessionScore } = require("./sessionScoreAggregator");
const { calculateEloUpdate } = require("./eloRating");
const { applyCodeStyleRubric } = require("../../scripts/applyCodeStyleRubric");
const seedQuestions = require("../../seed/questions.json");

const STYLE = "Readability and code style";

// Build the raw JSON the model would return. Points are in rubric order:
// [correctness, edge cases, efficiency, style, explanation].
function rawEvaluation(points) {
  return {
    feedback: "Overall feedback.",
    strengths: ["A strength"],
    weaknesses: ["A weakness"],
    suggestions: ["A suggestion"],
    criterionResults: CODE_STYLE_RUBRIC.map((criterion, index) => ({
      name: criterion.name,
      awardedPoints: points[index],
      feedback: `${criterion.name} feedback.`,
    })),
  };
}

function grade(points) {
  return normalizeEvaluation(rawEvaluation(points), CODE_STYLE_RUBRIC);
}

function styleCriterion() {
  return CODE_STYLE_RUBRIC.find((criterion) => criterion.name === STYLE);
}

beforeEach(() => {
  jest.clearAllMocks();
  getAiConfig.mockResolvedValue({ anthropicApiKey: "test-key" });
});

describe("Code Style rubric", () => {
  test("has the expected criteria and weights, in order", () => {
    expect(
      CODE_STYLE_RUBRIC.map(({ name, weight }) => [name, weight])
    ).toEqual([
      ["Core correctness", 60],
      ["Edge cases and robustness", 15],
      ["Efficiency", 10],
      [STYLE, 10],
      ["Explanation", 5],
    ]);
  });

  test("weights total 100 and pass the server's rubric validation", () => {
    const total = CODE_STYLE_RUBRIC.reduce((sum, c) => sum + c.weight, 0);

    expect(total).toBe(100);
    expect(
      validateRubric({
        mode: "Code Style",
        prompt: "Write a function.",
        referenceAnswer: "A reference solution.",
        gradingCriteria: CODE_STYLE_RUBRIC,
      })
    ).toBeNull();
  });

  test("the style criterion describes what good style looks like", () => {
    const description = styleCriterion().description;

    expect(description).toMatch(/descriptive names/);
    expect(description).toMatch(/structure and decomposition/);
    expect(description).toMatch(/dead, commented-out or needlessly duplicated code/);
    expect(description).toMatch(/consistent formatting/);
    expect(description).toMatch(/idiomatic/);
  });

  test("the style criterion accepts any consistent convention and does not require comments", () => {
    const description = styleCriterion().description;

    expect(description).toMatch(/camelCase or snake_case/);
    expect(description).toMatch(/do not require comments/);
    expect(description).toMatch(/comments that only restate the code/);
  });

  test("style cannot make up for code that does not attempt the task", () => {
    expect(styleCriterion().description).toMatch(
      /does not genuinely attempt the task .* award 0 for this criterion/
    );
  });

  test("other criteria do not penalize style a second time", () => {
    const byName = Object.fromEntries(
      CODE_STYLE_RUBRIC.map((criterion) => [criterion.name, criterion.description])
    );

    expect(byName["Core correctness"]).toMatch(/or for style issues/);
    expect(byName.Efficiency).toMatch(/Do not deduct here for naming, formatting/);
    expect(byName.Explanation).toMatch(/readability points/);
  });

  test("cannot be changed at runtime", () => {
    expect(Object.isFrozen(CODE_STYLE_RUBRIC)).toBe(true);
    expect(Object.isFrozen(styleCriterion())).toBe(true);
  });
});

describe("seed data", () => {
  const codeQuestions = seedQuestions.filter((q) => q.mode === "Code Style");
  const otherQuestions = seedQuestions.filter((q) => q.mode !== "Code Style");

  test("every Code Style question uses the Code Style rubric", () => {
    expect(codeQuestions.length).toBeGreaterThan(0);

    for (const question of codeQuestions) {
      expect(question.gradingCriteria).toEqual(CODE_STYLE_RUBRIC);
    }
  });

  test("other modes do not get the style criterion", () => {
    for (const question of otherQuestions) {
      const names = (question.gradingCriteria || []).map((c) => c.name);
      expect(names).not.toContain(STYLE);
    }
  });

  test("applying the rubric again changes nothing", () => {
    const { questions, updated } = applyCodeStyleRubric(seedQuestions);

    expect(updated).toBe(0);
    expect(questions).toEqual(seedQuestions);
  });

  test("the apply script only changes Code Style questions", () => {
    const sample = [
      {
        id: "code-1",
        mode: "Code Style",
        prompt: "Write a function.",
        referenceAnswer: "A reference solution.",
        gradingCriteria: [{ name: "Old", weight: 100, description: "Old." }],
      },
      {
        id: "theory-1",
        mode: "Theoretical Style",
        gradingCriteria: [{ name: "Accuracy", weight: 100, description: "x" }],
      },
      { id: "quiz-1", mode: "Quiz Style", correctAnswer: "A" },
    ];

    const { questions, updated } = applyCodeStyleRubric(sample);

    expect(updated).toBe(1);
    expect(questions[0].gradingCriteria).toEqual(CODE_STYLE_RUBRIC);
    expect(questions[1]).toBe(sample[1]);
    expect(questions[2]).toBe(sample[2]);
  });
});

describe("prompt", () => {
  async function sentPrompt() {
    mockCreate.mockResolvedValueOnce({
      content: [
        { type: "text", text: JSON.stringify(rawEvaluation([60, 15, 10, 10, 5])) },
      ],
    });

    await generateEvaluation({
      question: {
        id: "code-style-1",
        mode: "Code Style",
        prompt: "Return the largest number in an array.",
        referenceAnswer: "Track the maximum while looping.",
        gradingCriteria: CODE_STYLE_RUBRIC,
      },
      candidateResponse: "function max(a) { return Math.max(...a); }",
      gradingCriteria: CODE_STYLE_RUBRIC,
    });

    return mockCreate.mock.calls[0][0].messages[0].content;
  }

  test("lists the style criterion with its allowed points", async () => {
    expect(await sentPrompt()).toContain(
      `${STYLE} (10 points; allowed: 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10)`
    );
  });

  test("tells the model to grade readability and code style", async () => {
    const prompt = await sentPrompt();

    expect(prompt).toContain(
      "For code questions, focus on correctness, edge cases, complexity, readability and code style"
    );
    expect(prompt).toContain("judge it only from the submitted code");
  });

  test("includes the style guardrails", async () => {
    const prompt = await sentPrompt();

    expect(prompt).toContain("Accept any consistent naming or formatting convention");
    expect(prompt).toContain("Style never makes up for incorrect logic");
    expect(prompt).toContain(
      "If the code does not genuinely attempt the task, award 0 for readability and code style"
    );
  });

  test("makes formatting an exception only for the style criterion", async () => {
    expect(await sentPrompt()).toContain(
      "The one exception is a readability or code style criterion"
    );
  });

  test("no longer tells the model to put style below everything else", async () => {
    expect(await sentPrompt()).not.toContain("over minor style issues");
  });
});

describe("style-related scoring", () => {
  test("correct, clean code gets full marks", () => {
    expect(grade([60, 15, 10, 10, 5]).score).toBe(100);
  });

  test("correct but messy code loses only the style points", () => {
    const clean = grade([60, 15, 10, 10, 5]);
    const messy = grade([60, 15, 10, 3, 5]);

    expect(clean.score - messy.score).toBe(7);
    // Every other criterion is unchanged.
    expect(
      messy.criterionResults
        .filter((r) => r.name !== STYLE)
        .map((r) => r.awardedPoints)
    ).toEqual([60, 15, 10, 5]);
  });

  test("the most style can cost is 10 points", () => {
    expect(grade([60, 15, 10, 10, 5]).score - grade([60, 15, 10, 0, 5]).score).toBe(10);
  });

  test("tidy but broken code scores well below correct but messy code", () => {
    const tidyButBroken = grade([12, 3, 5, 9, 5]);
    const correctButMessy = grade([60, 15, 10, 2, 5]);

    expect(correctButMessy.score).toBeGreaterThan(tidyButBroken.score);
    expect(correctButMessy.score - tidyButBroken.score).toBeGreaterThanOrEqual(50);
  });

  test("a placeholder function scores 0", () => {
    expect(grade([0, 0, 0, 0, 0]).score).toBe(0);
  });

  test("style points above 10 are rejected", () => {
    expect(() => grade([60, 15, 10, 11, 5])).toThrow(/between 0 and 10/);
  });

  test("in-between style points snap to a whole point", () => {
    const result = grade([60, 15, 10, 6.6, 5]);
    const style = result.criterionResults.find((r) => r.name === STYLE);

    expect(style.awardedPoints).toBe(7);
  });
});

describe("impact on ELO", () => {
  function sessionScore(pointsPerQuestion) {
    return aggregateSessionScore(
      pointsPerQuestion.map((points) => ({ evaluation: grade(points) }))
    ).score;
  }

  function eloForFiveQuestionSession(score) {
    return calculateEloUpdate({
      currentElo: 1000,
      sessionScore: score,
      experienceLevel: "Intermediate",
      questionCount: 5,
    });
  }

  test("clean code earns a better ELO change than messy code with the same logic", () => {
    // Five questions are required for a ranked session, not the old 3-question sample.
    const cleanScore = sessionScore([
      [60, 15, 10, 10, 5],
      [54, 12, 9, 9, 5],
      [48, 12, 8, 9, 4],
      [60, 15, 10, 10, 5],
      [54, 12, 9, 9, 5],
    ]);
    const messyScore = sessionScore([
      [60, 15, 10, 2, 5],
      [54, 12, 9, 3, 5],
      [48, 12, 8, 2, 4],
      [60, 15, 10, 2, 5],
      [54, 12, 9, 3, 5],
    ]);

    const clean = eloForFiveQuestionSession(cleanScore);
    const messy = eloForFiveQuestionSession(messyScore);

    expect(clean.eloChange).toBeGreaterThan(messy.eloChange);
  });

  test("style alone costs 2 ELO in a five-question Intermediate session", () => {
    const clean = Array.from({ length: 5 }, () => [60, 15, 10, 10, 5]);
    const messy = Array.from({ length: 5 }, () => [60, 15, 10, 0, 5]);
    const best = eloForFiveQuestionSession(sessionScore(clean));
    const worst = eloForFiveQuestionSession(sessionScore(messy));

    expect(best.eloChange - worst.eloChange).toBe(2);
  });
});
