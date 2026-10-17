const {
  AI_GRADABLE_MODES,
  validateRubric,
  formatRubric,
  normalizeEvaluation,
} = require("./evaluationContract");

const validQuestion = {
  id: "q1",
  mode: "Theoretical Style",
  prompt: "Explain closures.",
  referenceAnswer:
    "A closure retains access to its lexical scope.",
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

const validEvaluation = {
  feedback: "Good answer overall.",
  strengths: ["Accurate explanation"],
  weaknesses: ["Could include an example"],
  suggestions: ["Add a practical example"],
  criterionResults: [
    {
      name: "Accuracy",
      awardedPoints: 55,
      feedback: "Mostly accurate.",
    },
    {
      name: "Clarity",
      awardedPoints: 30,
      feedback: "Clear explanation.",
    },
  ],
};

describe("evaluationContract", () => {
  describe("AI_GRADABLE_MODES", () => {
    it("includes Code Style and Theoretical Style", () => {
      expect(
        AI_GRADABLE_MODES.has("Code Style")
      ).toBe(true);

      expect(
        AI_GRADABLE_MODES.has("Theoretical Style")
      ).toBe(true);
    });

    it("does not include Quiz Style", () => {
      expect(
        AI_GRADABLE_MODES.has("Quiz Style")
      ).toBe(false);
    });
  });

  describe("validateRubric", () => {
    it("accepts a valid grading rubric", () => {
      expect(validateRubric(validQuestion)).toBeNull();
    });

    it("rejects a missing question", () => {
      expect(validateRubric()).toBe(
        "AI-graded questions require a prompt."
      );
    });

    it("rejects a missing or blank prompt", () => {
      expect(
        validateRubric({
          ...validQuestion,
          prompt: "   ",
        })
      ).toBe(
        "AI-graded questions require a prompt."
      );
    });

    it("rejects a missing or blank reference answer", () => {
      expect(
        validateRubric({
          ...validQuestion,
          referenceAnswer: "   ",
        })
      ).toBe(
        "AI-graded questions require a private referenceAnswer."
      );
    });

    it("requires at least two grading criteria", () => {
      expect(
        validateRubric({
          ...validQuestion,
          gradingCriteria: [
            {
              name: "Accuracy",
              weight: 100,
              description: "Correct answer.",
            },
          ],
        })
      ).toBe(
        "AI-graded questions require at least two gradingCriteria entries."
      );
    });

    it("rejects a gradingCriteria value that is not an array", () => {
      expect(
        validateRubric({
          ...validQuestion,
          gradingCriteria: null,
        })
      ).toBe(
        "AI-graded questions require at least two gradingCriteria entries."
      );
    });

    it("rejects a criterion without a name", () => {
      expect(
        validateRubric({
          ...validQuestion,
          gradingCriteria: [
            {
              name: "",
              weight: 60,
              description: "Correct answer.",
            },
            {
              name: "Clarity",
              weight: 40,
              description: "Clear answer.",
            },
          ],
        })
      ).toBe(
        "Every grading criterion requires a name and description."
      );
    });

    it("rejects a criterion without a description", () => {
      expect(
        validateRubric({
          ...validQuestion,
          gradingCriteria: [
            {
              name: "Accuracy",
              weight: 60,
              description: "",
            },
            {
              name: "Clarity",
              weight: 40,
              description: "Clear answer.",
            },
          ],
        })
      ).toBe(
        "Every grading criterion requires a name and description."
      );
    });

    it("rejects a non-numeric criterion weight", () => {
      expect(
        validateRubric({
          ...validQuestion,
          gradingCriteria: [
            {
              name: "Accuracy",
              weight: "not-a-number",
              description: "Correct answer.",
            },
            {
              name: "Clarity",
              weight: 40,
              description: "Clear answer.",
            },
          ],
        })
      ).toBe(
        "Every grading criterion requires a positive numeric weight."
      );
    });

    it("rejects a zero criterion weight", () => {
      expect(
        validateRubric({
          ...validQuestion,
          gradingCriteria: [
            {
              name: "Accuracy",
              weight: 0,
              description: "Correct answer.",
            },
            {
              name: "Clarity",
              weight: 100,
              description: "Clear answer.",
            },
          ],
        })
      ).toBe(
        "Every grading criterion requires a positive numeric weight."
      );
    });

    it("rejects a negative criterion weight", () => {
      expect(
        validateRubric({
          ...validQuestion,
          gradingCriteria: [
            {
              name: "Accuracy",
              weight: -10,
              description: "Correct answer.",
            },
            {
              name: "Clarity",
              weight: 110,
              description: "Clear answer.",
            },
          ],
        })
      ).toBe(
        "Every grading criterion requires a positive numeric weight."
      );
    });

    it("rejects criterion weights that do not total 100", () => {
      expect(
        validateRubric({
          ...validQuestion,
          gradingCriteria: [
            {
              name: "Accuracy",
              weight: 50,
              description: "Correct answer.",
            },
            {
              name: "Clarity",
              weight: 40,
              description: "Clear answer.",
            },
          ],
        })
      ).toBe(
        "AI grading criterion weights must total 100. Current total: 90."
      );
    });

    it("accepts numeric weights provided as strings when they total 100", () => {
      expect(
        validateRubric({
          ...validQuestion,
          gradingCriteria: [
            {
              name: "Accuracy",
              weight: "60",
              description: "Correct answer.",
            },
            {
              name: "Clarity",
              weight: "40",
              description: "Clear answer.",
            },
          ],
        })
      ).toBeNull();
    });
  });

  describe("formatRubric", () => {
    it("formats grading criteria for the AI prompt", () => {
      expect(
        formatRubric(validQuestion.gradingCriteria)
      ).toBe(
        "1. Accuracy (60 points): Correctly explains lexical scope.\n" +
          "2. Clarity (40 points): Explains the idea clearly."
      );
    });
  });

  describe("normalizeEvaluation", () => {
    it("normalizes a valid AI evaluation", () => {
      expect(
        normalizeEvaluation(
          validEvaluation,
          validQuestion.gradingCriteria
        )
      ).toEqual({
        score: 85,
        feedback: "Good answer overall.",
        strengths: ["Accurate explanation"],
        weaknesses: ["Could include an example"],
        suggestions: ["Add a practical example"],
        criterionResults: [
          {
            name: "Accuracy",
            awardedPoints: 55,
            maxPoints: 60,
            feedback: "Mostly accurate.",
          },
          {
            name: "Clarity",
            awardedPoints: 30,
            maxPoints: 40,
            feedback: "Clear explanation.",
          },
        ],
      });
    });

    it("calculates the score when the AI does not provide one", () => {
      const result = normalizeEvaluation(
        validEvaluation,
        validQuestion.gradingCriteria
      );

      expect(validEvaluation.score).toBeUndefined();
      expect(result.score).toBe(85);
    });

    it("calculates the score itself instead of trusting an AI-provided score", () => {
      const result = normalizeEvaluation(
        {
          ...validEvaluation,
          score: 5,
        },
        validQuestion.gradingCriteria
      );

      expect(result.score).toBe(85);
    });

    it("rounds individual awarded points to one decimal place", () => {
      const result = normalizeEvaluation(
        {
          ...validEvaluation,
          criterionResults: [
            {
              name: "Accuracy",
              awardedPoints: 55.55,
              feedback: "Mostly accurate.",
            },
            {
              name: "Clarity",
              awardedPoints: 30.34,
              feedback: "Clear explanation.",
            },
          ],
        },
        validQuestion.gradingCriteria
      );

      expect(
        result.criterionResults[0].awardedPoints
      ).toBe(55.6);

      expect(
        result.criterionResults[1].awardedPoints
      ).toBe(30.3);

      expect(result.score).toBe(86);
    });

    it("rejects a response missing criterionResults", () => {
      expect(() =>
        normalizeEvaluation(
          {
            feedback: "Good answer.",
          },
          validQuestion.gradingCriteria
        )
      ).toThrow(
        "AI response is missing criterionResults."
      );
    });

    it("rejects the wrong number of criterion results", () => {
      expect(() =>
        normalizeEvaluation(
          {
            ...validEvaluation,
            criterionResults: [
              {
                name: "Accuracy",
                awardedPoints: 50,
                feedback: "Good.",
              },
            ],
          },
          validQuestion.gradingCriteria
        )
      ).toThrow(
        "AI response did not return one result for each grading criterion."
      );
    });

    it("rejects missing awardedPoints", () => {
      expect(() =>
        normalizeEvaluation(
          {
            ...validEvaluation,
            criterionResults: [
              {
                name: "Accuracy",
                feedback: "Good.",
              },
              {
                name: "Clarity",
                awardedPoints: 30,
                feedback: "Good.",
              },
            ],
          },
          validQuestion.gradingCriteria
        )
      ).toThrow(
        "AI result for Accuracy is missing awardedPoints."
      );
    });

    it("rejects a non-numeric awardedPoints value", () => {
      expect(() =>
        normalizeEvaluation(
          {
            ...validEvaluation,
            criterionResults: [
              {
                name: "Accuracy",
                awardedPoints: "not-a-number",
                feedback: "Good.",
              },
              {
                name: "Clarity",
                awardedPoints: 30,
                feedback: "Good.",
              },
            ],
          },
          validQuestion.gradingCriteria
        )
      ).toThrow(
        "AI result for Accuracy is missing awardedPoints."
      );
    });

    it("rejects awarded points below zero", () => {
      expect(() =>
        normalizeEvaluation(
          {
            ...validEvaluation,
            criterionResults: [
              {
                name: "Accuracy",
                awardedPoints: -1,
                feedback: "Invalid.",
              },
              {
                name: "Clarity",
                awardedPoints: 30,
                feedback: "Good.",
              },
            ],
          },
          validQuestion.gradingCriteria
        )
      ).toThrow(
        "AI awardedPoints for Accuracy must be between 0 and 60."
      );
    });

    it("rejects awarded points greater than the criterion maximum", () => {
      expect(() =>
        normalizeEvaluation(
          {
            ...validEvaluation,
            criterionResults: [
              {
                name: "Accuracy",
                awardedPoints: 61,
                feedback: "Invalid.",
              },
              {
                name: "Clarity",
                awardedPoints: 30,
                feedback: "Good.",
              },
            ],
          },
          validQuestion.gradingCriteria
        )
      ).toThrow(
        "AI awardedPoints for Accuracy must be between 0 and 60."
      );
    });

    it("rejects missing criterion feedback", () => {
      expect(() =>
        normalizeEvaluation(
          {
            ...validEvaluation,
            criterionResults: [
              {
                name: "Accuracy",
                awardedPoints: 55,
                feedback: "   ",
              },
              {
                name: "Clarity",
                awardedPoints: 30,
                feedback: "Good.",
              },
            ],
          },
          validQuestion.gradingCriteria
        )
      ).toThrow(
        "AI result for Accuracy is missing feedback."
      );
    });

    it("rejects missing overall feedback", () => {
      expect(() =>
        normalizeEvaluation(
          {
            ...validEvaluation,
            feedback: "   ",
          },
          validQuestion.gradingCriteria
        )
      ).toThrow(
        "AI response is missing overall feedback."
      );
    });

    it("uses empty arrays when optional feedback lists are not arrays", () => {
      const result = normalizeEvaluation(
        {
          ...validEvaluation,
          strengths: "not-an-array",
          weaknesses: null,
          suggestions: undefined,
        },
        validQuestion.gradingCriteria
      );

      expect(result.strengths).toEqual([]);
      expect(result.weaknesses).toEqual([]);
      expect(result.suggestions).toEqual([]);
    });

    it("trims feedback list entries and removes empty values", () => {
      const result = normalizeEvaluation(
        {
          ...validEvaluation,
          strengths: [
            "  Accurate explanation  ",
            "",
            "   ",
            "Clear wording",
          ],
        },
        validQuestion.gradingCriteria
      );

      expect(result.strengths).toEqual([
        "Accurate explanation",
        "Clear wording",
      ]);
    });

    it("limits feedback arrays to six entries", () => {
      const result = normalizeEvaluation(
        {
          ...validEvaluation,
          strengths: [
            "1",
            "2",
            "3",
            "4",
            "5",
            "6",
            "7",
            "8",
          ],
        },
        validQuestion.gradingCriteria
      );

      expect(result.strengths).toEqual([
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
      ]);
    });
  });
});