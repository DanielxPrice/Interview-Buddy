const allQuestions = require("../seed/questions.json");
const { validateQuestion, validateSeedData, formatSummary } = require("./validateQuestionSeed");

const quiz = allQuestions.find((question) => question.mode === "Quiz Style");
const code = allQuestions.find((question) => question.mode === "Code Style");
const theory = allQuestions.find((question) => question.mode === "Theoretical Style");

const fixtures = () => [quiz, code, theory].map((question) => structuredClone(question));

function invalid(change, index = 0) {
  const questions = fixtures();
  Object.assign(questions[index], change);
  return () => validateSeedData(questions, { enforceCoverage: false });
}

describe("validateQuestionSeed H-01 schema and dataset checks", () => {
  test("accepts the current full 1500-question dataset and all three modes", () => {
    const summary = validateSeedData(allQuestions);
    expect(summary.total).toBe(1500);
    for (const mode of ["Quiz Style", "Code Style", "Theoretical Style"]) {
      expect(summary.modeCounts.get(mode)).toBe(500);
    }
    expect(formatSummary(summary)).toContain("Validated 1500 questions.");
  });

  test("accepts representative Quiz, Code, and Theoretical fixtures", () => {
    expect(() => validateSeedData(fixtures(), { enforceCoverage: false }))
      .not.toThrow();
  });

  test("rejects empty datasets and duplicate IDs", () => {
    expect(() => validateSeedData([])).toThrow(/non-empty array/);
    expect(() => validateSeedData([quiz, { ...quiz }], { enforceCoverage: false }))
      .toThrow(/Duplicate question id/);
  });

  test("rejects missing question identity, prompt, and unsupported mode", () => {
    expect(invalid({ id: " " })).toThrow(/nonblank id/);
    expect(invalid({ prompt: " " })).toThrow(/nonblank id, mode, and prompt/);
    expect(invalid({ mode: "Unknown" })).toThrow(/invalid mode/);
  });

  test("rejects missing or invalid display and selection metadata", () => {
    expect(invalid({ topic: "" })).toThrow(/nonblank topic/);
    expect(invalid({ difficulty: "Veteran" })).toThrow(/invalid difficulty/);
    expect(invalid({ active: "true" })).toThrow(/boolean active/);
    expect(invalid({ priority: "10" })).toThrow(/numeric priority/);
    expect(invalid({ tags: [" "] })).toThrow(/nonblank strings/);
    expect(invalid({ jobRoles: [] })).toThrow(/non-empty jobRoles/);
    expect(invalid({ experienceLevels: ["Expert"] })).toThrow(/unsupported experienceLevels/);
    expect(invalid({ tags: ["tree", "TREE"] })).toThrow(/duplicate tags/);
  });

  test("rejects malformed Quiz answer choices and explanations", () => {
    expect(invalid({ options: ["Yes", " "] })).toThrow(/nonblank options/);
    expect(invalid({ options: ["Yes", "yes"], correctAnswer: "Yes" }))
      .toThrow(/duplicate options/);
    expect(invalid({ correctAnswer: "Not present" })).toThrow(/outside options/);
    expect(invalid({ explanation: "" })).toThrow(/correctAnswer and explanation/);
  });

  test("rejects missing Code and Theoretical rubrics", () => {
    expect(invalid({ referenceAnswer: "" }, 1)).toThrow(/invalid rubric/);
    expect(invalid({ gradingCriteria: [] }, 2)).toThrow(/invalid rubric/);
    const badWeights = structuredClone(code.gradingCriteria);
    badWeights[0].weight += 5;
    expect(invalid({ gradingCriteria: badWeights }, 1)).toThrow(/must total 100/);
  });

  test("rejects seed coverage that is insufficient for production", () => {
    expect(() => validateSeedData(fixtures())).toThrow(/500-1000 questions/);
    expect(() => validateQuestion(null)).toThrow(/nonblank id/);
  });
});
