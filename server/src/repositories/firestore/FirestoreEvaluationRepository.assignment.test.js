
"use strict";

const FirestoreEvaluationRepository =
  require("./FirestoreEvaluationRepository");

const testEvaluation = {
  userId: "owner-1",
  sessionId: "session-1",
  questionId: "theory-1",
  questionPrompt: "Explain queues.",
  mode: "Theoretical Style",
  candidateResponse: "First in, first out.",
  evaluation: {
    score: 90,
    feedback: "Accurate.",
  },
  evaluatedAt: "2026-10-27T00:00:00.000Z",
};

function fixture(
  overrides = {},
  responseExists = false
) {
  const sessionRef = {
    id: "session-1",
  };

  const responseRef = {
    id: "theory-1",
  };

  sessionRef.collection =
    jest.fn().mockReturnValue({
      doc: jest.fn().mockReturnValue(
        responseRef
      ),
    });

  const transaction = {
    get: jest.fn(async (ref) => {
      if (ref === responseRef) {
        return {
          exists: responseExists,
        };
      }

      return {
        exists: true,
        data: () => ({
          userId: "owner-1",
          status: "active",
          mode: "Theoretical Style",
          assignmentStatus: "assigned",
          assignedQuestionIds: [
            "theory-1",
          ],
          ...overrides,
        }),
      };
    }),

    update: jest.fn(),
    set: jest.fn(),
  };

  const db = {
    collection: jest.fn().mockReturnValue({
      doc: jest.fn().mockReturnValue(
        sessionRef
      ),
    }),

    runTransaction: jest.fn(
      async (callback) =>
        callback(transaction)
    ),
  };

  const repo =
    new FirestoreEvaluationRepository({
      db,
      admin: null,
    });

  return {
    repo,
    transaction,
    db,
    sessionRef,
    responseRef,
  };
}

describe("SEC-03 Firestore AI evaluation write authorization", () => {
  test("saves one assigned answer using an atomic transaction", async () => {
    const f = fixture();

    await f.repo.saveEvaluation(
      testEvaluation
    );

    expect(
      f.db.runTransaction
    ).toHaveBeenCalledTimes(1);

    expect(
      f.transaction.set
    ).toHaveBeenCalledWith(
      f.responseRef,
      expect.objectContaining({
        questionId: "theory-1",
        evaluation:
          testEvaluation.evaluation,
      })
    );

    expect(
      f.transaction.update
    ).toHaveBeenCalledTimes(1);
  });

  test.each([
    [
      { userId: "other-owner" },
      403,
      "SESSION_FORBIDDEN",
    ],
    [
      { status: "completed" },
      409,
      "SESSION_NOT_ACTIVE",
    ],
    [
      { mode: "Code Style" },
      409,
      "SESSION_MODE_MISMATCH",
    ],
    [
      { assignmentStatus: "pending" },
      409,
      "ASSIGNMENT_NOT_READY",
    ],
    [
      {
        assignedQuestionIds: [
          "theory-2",
        ],
      },
      409,
      "QUESTION_NOT_ASSIGNED",
    ],
  ])(
    "rejects invalid session state %o inside the transaction",
    async (changes, statusCode, code) => {
      const f = fixture(changes);

      await expect(
        f.repo.saveEvaluation(
          testEvaluation
        )
      ).rejects.toMatchObject({
        statusCode,
        code,
      });

      expect(
        f.transaction.set
      ).not.toHaveBeenCalled();

      expect(
        f.transaction.update
      ).not.toHaveBeenCalled();
    }
  );

  test("rejects a duplicate response without replacing the prior grade", async () => {
    const f = fixture({}, true);

    await expect(
      f.repo.saveEvaluation(
        testEvaluation
      )
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "QUESTION_ALREADY_ANSWERED",
    });

    expect(
      f.transaction.set
    ).not.toHaveBeenCalled();
  });

  test("requires the authenticated user ID", async () => {
    const f = fixture();

    await expect(
      f.repo.saveEvaluation({
        ...testEvaluation,
        userId: null,
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "EVALUATION_IDENTIFIERS_REQUIRED",
    });

    expect(
      f.db.runTransaction
    ).not.toHaveBeenCalled();
  });
});
