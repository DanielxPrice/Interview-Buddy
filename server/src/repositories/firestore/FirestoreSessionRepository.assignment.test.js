
const FirestoreSessionRepository = require(
  "./FirestoreSessionRepository"
);

const setup = {
  mode: "Quiz Style",
  jobRole: "Software Engineer",
  experienceLevel: "Beginner",
  tags: ["trees"],
  questionCount: 1,
};

const question = {
  id: "quiz-1",
  mode: "Quiz Style",
  prompt: "Which option is correct?",
  options: ["A", "B"],
  tags: ["trees"],
  correctAnswer: "A",
  referenceAnswer: "secret",
  gradingCriteria: ["private"],
};

function fixture(overrides = {}) {
  const stored = {
    userId: "owner",
    status: "active",
    assignmentStatus: "pending",
    assignedQuestionIds: [],
    assignedQuestions: [],
    ...setup,
    ...overrides,
  };

  const reference = {
    id: "session-1",
  };

  const update = jest.fn((_, patch) => {
    Object.assign(stored, patch);
  });

  const tx = {
    get: jest.fn(async () => ({
      exists: true,
      data: () => stored,
    })),
    update,
  };

  const db = {
    collection: jest.fn(() => ({
      doc: jest.fn(() => reference),
    })),
    runTransaction: jest.fn(async (fn) => fn(tx)),
  };

  return {
    repo: new FirestoreSessionRepository({
      db,
      admin: null,
    }),
    stored,
    update,
    tx,
    db,
  };
}

describe("SEC-03 immutable Firestore question assignment", () => {
  test("atomically records public questions and assigned IDs", async () => {
    const f = fixture();

    const result = await f.repo.assignQuestions({
      sessionId: "session-1",
      userId: "owner",
      setup,
      questions: [question],
    });

    expect(result).toHaveLength(1);

    expect(result[0]).not.toHaveProperty(
      "correctAnswer"
    );

    expect(result[0]).not.toHaveProperty(
      "referenceAnswer"
    );

    expect(result[0]).not.toHaveProperty(
      "gradingCriteria"
    );

    expect(f.update).toHaveBeenCalledTimes(1);

    expect(f.stored.assignedQuestionIds).toEqual([
      "quiz-1",
    ]);

    expect(f.stored.assignmentStatus).toBe(
      "assigned"
    );
  });

  test("retry preserves first assignment even when later selection changes", async () => {
    const f = fixture();

    const first = await f.repo.assignQuestions({
      sessionId: "session-1",
      userId: "owner",
      setup,
      questions: [question],
    });

    const retry = await f.repo.assignQuestions({
      sessionId: "session-1",
      userId: "owner",
      setup,
      questions: [
        {
          ...question,
          id: "quiz-2",
          prompt: "Another question",
        },
      ],
    });

    expect(retry).toEqual(first);
    expect(f.update).toHaveBeenCalledTimes(1);
  });

  test("rejects another user's request", async () => {
    const f = fixture();

    await expect(
      f.repo.assignQuestions({
        sessionId: "session-1",
        userId: "intruder",
        setup,
        questions: [question],
      })
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "SESSION_FORBIDDEN",
    });

    expect(f.update).not.toHaveBeenCalled();
  });

  test("rejects altered session configuration", async () => {
    const f = fixture();

    await expect(
      f.repo.assignQuestions({
        sessionId: "session-1",
        userId: "owner",
        setup: {
          ...setup,
          tags: ["arrays"],
        },
        questions: [question],
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "SESSION_SETUP_MISMATCH",
    });

    expect(f.update).not.toHaveBeenCalled();
  });

  test("does not assign to completed sessions", async () => {
    const f = fixture({
      status: "completed",
    });

    await expect(
      f.repo.assignQuestions({
        sessionId: "session-1",
        userId: "owner",
        setup,
        questions: [question],
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "SESSION_NOT_ACTIVE",
    });

    expect(f.update).not.toHaveBeenCalled();
  });

  test("rejects wrong counts, duplicates and wrong modes", async () => {
    const f = fixture();

    for (const questions of [
      [],
      [question, question],
      [
        {
          ...question,
          mode: "Code Style",
        },
      ],
    ]) {
      await expect(
        f.repo.assignQuestions({
          sessionId: "session-1",
          userId: "owner",
          setup,
          questions,
        })
      ).rejects.toMatchObject({
        statusCode: expect.any(Number),
      });
    }

    expect(f.update).not.toHaveBeenCalled();
  });
});
