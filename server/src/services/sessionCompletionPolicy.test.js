
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

  //Tests that close the gap between different interview mode scoring
  describe("Scoring normalization across interview modes", () => {
    const modes = [
      "Code Style",
      "Theoretical Style",
      "Quiz Style",
    ];

    test.each(modes)(
      "%s uses the same normalized 0-100 session score",
      (mode) => {
        const modeSession = {
          ...session,
          mode,
        };

        const scores =
          mode === "Quiz Style"
            ? [100, 0, 100]
            : [100, 40, 60];

        const docs = scores.map((score, index) =>
          response(`q${index + 1}`, score, { mode })
        );

        const result = calculateSessionCompletion(
          modeSession,
          docs
        );

        const expectedScore = Math.round(
          scores.reduce((sum, score) => sum + score, 0) /
            modeSession.questionCount
        );

        expect(result.score).toBe(expectedScore);
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(100);
        expect(result.questionsAnswered).toBe(3);
        expect(result.completionStatus).toBe("completed");
        expect(result.rankEligible).toBe(true);
      }
    );

    test.each(modes)(
      "%s counts unanswered questions as zero",
      (mode) => {
        const modeSession = {
          ...session,
          mode,
        };

        const result = calculateSessionCompletion(
          modeSession,
          [response("q1", 100, { mode })]
        );

        expect(result).toMatchObject({
          score: 33,
          totalScore: 100,
          questionsAnswered: 1,
          questionsAssigned: 3,
          questionsUnanswered: 2,
          answeredAverageScore: 100,
          completionStatus: "partial",
          rankEligible: false,
        });
      }
    );

    test.each(modes)(
      "%s rejects invalid scores and mismatched modes",
      (mode) => {
        const modeSession = {
          ...session,
          mode,
        };

        for (const invalidScore of [-1, 101, Infinity, NaN]) {
          expect(() =>
            calculateSessionCompletion(modeSession, [
              response("q1", invalidScore, { mode }),
            ])
          ).toThrow(/invalid scoring data/i);
        }

        const wrongMode = modes.find(
          (candidate) => candidate !== mode
        );

        expect(() =>
          calculateSessionCompletion(modeSession, [
            response("q1", 100, { mode: wrongMode }),
          ])
        ).toThrow(/invalid scoring data/i);
      }
    );

    test.each(["Code Style", "Theoretical Style"])(
      "%s consistently rounds fractional AI scores",
      (mode) => {
        const modeSession = {
          ...session,
          mode,
        };

        const result = calculateSessionCompletion(
          modeSession,
          [
            response("q1", 85.5, { mode }),
            response("q2", 84.5, { mode }),
            response("q3", 80, { mode }),
          ]
        );

        expect(result.totalScore).toBe(250);
        expect(result.score).toBe(83);
        expect(result.answeredAverageScore).toBe(83);
      }
    );
  });
});
