
const {
  validateSessionSetup,
  sameSetup,
  assertOwnedActiveSession,
  assertAssignedQuestion,
} = require("./sessionAssignmentPolicy");

const valid = {
  mode: "Quiz Style",
  jobRole: "Software Engineer",
  experienceLevel: "Beginner",
  tags: ["Trees", "Algorithms"],
  questionCount: 2,
};

describe("SEC-03 authoritative session setup policy", () => {
  test("normalizes tags and preserves the selected count", () => {
    expect(validateSessionSetup(valid)).toEqual({
      ...valid,
      tags: ["algorithms", "trees"],
    });
  });

  test.each([0, 21, "2", 1.5, null])(
    "rejects invalid question count %p",
    (questionCount) => {
      expect(() =>
        validateSessionSetup({
          ...valid,
          questionCount,
        })
      ).toThrow(/question count/i);
    }
  );

  test("requires supported mode and tags", () => {
    expect(() =>
      validateSessionSetup({
        ...valid,
        mode: "Not supported",
      })
    ).toThrow(/supported interview mode/i);

    expect(() =>
      validateSessionSetup({
        ...valid,
        tags: [],
      })
    ).toThrow(/practice tags/i);
  });

  test("compares all saved setup fields", () => {
    const stored = validateSessionSetup(valid);

    expect(
      sameSetup(stored, {
        ...valid,
        jobRole: "software engineer",
        tags: ["algorithms", "TREES"],
      })
    ).toBe(true);

    expect(
      sameSetup(stored, {
        ...valid,
        questionCount: 3,
      })
    ).toBe(false);

    expect(
      sameSetup(stored, {
        ...valid,
        tags: ["trees"],
      })
    ).toBe(false);
  });

  test("rejects other owners and inactive sessions", () => {
    const session = {
      userId: "owner",
      status: "active",
    };

    expect(() =>
      assertOwnedActiveSession(session, "owner")
    ).not.toThrow();

    expect(() =>
      assertOwnedActiveSession(session, "other")
    ).toThrow(/access/);

    expect(() =>
      assertOwnedActiveSession(
        {
          ...session,
          status: "completed",
        },
        "owner"
      )
    ).toThrow(/not active/);
  });

  test("SEC-05 blocks answers to expired leased sessions but preserves legacy sessions", () => {
    const session = { userId: "owner", status: "active" };
    expect(() => assertOwnedActiveSession({
      ...session, activeExpiresAtMs: Date.now() - 1000,
    }, "owner")).toThrow(/expired/i);
    expect(() => assertOwnedActiveSession({
      ...session, activeExpiresAtMs: Date.now() + 60000,
    }, "owner")).not.toThrow();
    expect(() => assertOwnedActiveSession(session, "owner")).not.toThrow();
  });

  test("accepts only assigned question IDs", () => {
    const session = {
      assignedQuestionIds: ["quiz-1"],
    };

    expect(() =>
      assertAssignedQuestion(session, "quiz-1")
    ).not.toThrow();

    expect(() =>
      assertAssignedQuestion(session, "quiz-2")
    ).toThrow(/not assigned/);
  });
});
