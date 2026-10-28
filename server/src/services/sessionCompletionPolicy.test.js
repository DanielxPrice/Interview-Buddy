
const {
  calculateSessionCompletion,
} = require("./sessionCompletionPolicy");

const session = {
  mode: "Code Style",
  questionCount: 3,
  assignmentStatus: "assigned",
  assignedQuestionIds: [
    "q1",
    "q2",
    "q3",
  ],
};

function response(id, score, overrides = {}) {
  return {
    id,

    data: () => ({
      questionId: id,
      mode: "Code Style",

      evaluation: {
        score,
      },

      ...overrides,
    }),
  };
}

describe("SEC-03 authoritative completion policy", () => {
  test("full completion uses the assigned count and is rank eligible", () => {
    const result = calculateSessionCompletion(
      session,
      [
        response("q1", 100),
        response("q2", 70),
        response("q3", 40),
      ]
    );

    expect(result).toMatchObject({
      score: 70,
      totalScore: 210,
      questionsAnswered: 3,
      questionsAssigned: 3,
      questionsUnanswered: 0,
      completionStatus: "completed",
      rankEligible: true,
    });
  });

  test("early ending uses all assigned questions as denominator", () => {
    const result = calculateSessionCompletion(
      session,
      [
        response("q1", 90),
      ]
    );

    expect(result).toEqual({
      score: 30,
      totalScore: 90,
      questionsAnswered: 1,
      questionsAssigned: 3,
      questionsUnanswered: 2,
      answeredAverageScore: 90,
      completionStatus: "partial",
      rankEligible: false,
    });
  });

  test("zero-response assigned session is abandoned and unranked", () => {
    expect(
      calculateSessionCompletion(
        session,
        []
      )
    ).toMatchObject({
      score: 0,
      questionsAnswered: 0,
      completionStatus: "abandoned",
      rankEligible: false,
    });
  });

  test("pending session with no responses may be abandoned", () => {
    expect(
      calculateSessionCompletion(
        {
          questionCount: 3,
          assignmentStatus: "pending",
          assignedQuestionIds: [],
        },
        []
      )
    ).toMatchObject({
      completionStatus: "abandoned",
      rankEligible: false,
    });
  });

  test.each([
    [
      "unassigned question",
      [response("unassigned", 100)],
    ],
    [
      "duplicate question",
      [
        response("q1", 80),
        response("q1", 90),
      ],
    ],
    [
      "mismatched document ID",
      [
        {
          id: "q2",
          data: () => ({
            questionId: "q1",
            mode: "Code Style",
            evaluation: {
              score: 100,
            },
          }),
        },
      ],
    ],
    [
      "wrong mode",
      [
        response("q1", 100, {
          mode: "Quiz Style",
        }),
      ],
    ],
    [
      "oversized score",
      [
        response("q1", 101),
      ],
    ],
    [
      "nonfinite score",
      [
        response("q1", Infinity),
      ],
    ],
  ])(
    "rejects %s without accepting the score",
    (_label, docs) => {
      expect(() =>
        calculateSessionCompletion(
          session,
          docs
        )
      ).toThrow(/invalid scoring data/i);
    }
  );

  test("rejects a missing or forged assignment", () => {
    expect(() =>
      calculateSessionCompletion(
        {
          ...session,
          assignedQuestionIds: [
            "q1",
            "q1",
            "q3",
          ],
        },
        []
      )
    ).toThrow(/assignment/i);

    expect(() =>
      calculateSessionCompletion(
        {
          ...session,
          questionCount: 4,
        },
        []
      )
    ).toThrow(/assignment/i);
  });

  test("rejects pending sessions that already contain responses", () => {
    expect(() =>
      calculateSessionCompletion(
        {
          ...session,
          assignmentStatus: "pending",
          assignedQuestionIds: [],
        },
        [
          response("q1", 100),
        ]
      )
    ).toThrow(/inconsistent/i);
  });
});
