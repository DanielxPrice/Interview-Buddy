
"use strict";

const FirestoreSessionRepository = require(
  "./FirestoreSessionRepository"
);

function fixture({
  assignmentStatus = "assigned",
  questionCount = 3,
  assignedQuestionIds = ["q1", "q2", "q3"],
  responses = [],
} = {}) {
  const session = {
    userId: "owner",
    mode: "Quiz Style",
    status: "active",
    assignmentStatus,
    questionCount,
    assignedQuestionIds,
  };

  const responsesRef = {};

  const sessionRef = {
    id: "session-1",
    collection: () => responsesRef,
  };

  const tx = {
    get: jest.fn(async (ref) => {
      if (ref === sessionRef) {
        return {
          exists: true,
          id: "session-1",
          data: () => session,
        };
      }

      if (ref === responsesRef) {
        return {
          docs: responses,
        };
      }

      throw new Error("unexpected read");
    }),

    update: jest.fn(),
  };

  const db = {
    collection: () => ({
      doc: () => sessionRef,
    }),

    runTransaction: jest.fn(
      async (work) => work(tx)
    ),
  };

  return {
    repo: new FirestoreSessionRepository({
      db,
      admin: null,
    }),

    session,
    tx,
    sessionRef,
  };
}

function answer(id, score) {
  return {
    id,

    data: () => ({
      questionId: id,
      mode: "Quiz Style",
      evaluation: {
        score,
      },
    }),
  };
}

describe("SEC-03 Firestore session completion integrity", () => {
  test("full assignment produces a ranked completed record", async () => {
    const f = fixture({
      responses: [
        answer("q1", 90),
        answer("q2", 90),
        answer("q3", 90),
      ],
    });

    const finished =
      await f.repo.finalizeSessionWithResults(
        "session-1",
        "owner"
      );

    expect(finished).toMatchObject({
      status: "completed",
      completionStatus: "completed",
      rankEligible: true,

      result: {
        score: 90,
        questionsAssigned: 3,
        questionsAnswered: 3,
      },
    });

    expect(f.tx.update).toHaveBeenCalledWith(
      f.sessionRef,

      expect.objectContaining({
        completionStatus: "completed",
        rankEligible: true,
      })
    );
  });

  test("an early end stays in History with partial outcome and no ranking", async () => {
    const f = fixture({
      responses: [
        answer("q1", 90),
      ],
    });

    const finished =
      await f.repo.finalizeSessionWithResults(
        "session-1",
        "owner"
      );

    expect(finished).toMatchObject({
      status: "completed",
      completionStatus: "partial",
      rankEligible: false,

      result: {
        score: 30,
        questionsAnswered: 1,
        questionsUnanswered: 2,
      },
    });
  });

  test("an empty pending assignment is explicitly abandoned", async () => {
    const f = fixture({
      assignmentStatus: "pending",
      assignedQuestionIds: [],
      responses: [],
    });

    const finished =
      await f.repo.finalizeSessionWithResults(
        "session-1",
        "owner"
      );

    expect(finished).toMatchObject({
      status: "completed",
      completionStatus: "abandoned",
      rankEligible: false,

      result: {
        questionsAssigned: 3,
        questionsAnswered: 0,
        score: 0,
      },
    });
  });

  test("a response to an unassigned question prevents score finalization", async () => {
    const f = fixture({
      responses: [
        answer("other", 100),
      ],
    });

    await expect(
      f.repo.finalizeSessionWithResults(
        "session-1",
        "owner"
      )
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "INVALID_SCORING_DATA",
    });

    expect(
      f.tx.update
    ).not.toHaveBeenCalled();
  });

  test("a forged assignment count prevents score finalization", async () => {
    const f = fixture({
      questionCount: 9,
    });

    await expect(
      f.repo.finalizeSessionWithResults(
        "session-1",
        "owner"
      )
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "SESSION_ASSIGNMENT_INVALID",
    });

    expect(
      f.tx.update
    ).not.toHaveBeenCalled();
  });

  test("repeated completion returns saved result without rewriting", async () => {
    const f = fixture();

    f.session.status = "completed";

    f.session.result = {
      score: 12,
      completionStatus: "partial",
      rankEligible: false,
    };

    const returned =
      await f.repo.finalizeSessionWithResults(
        "session-1",
        "owner"
      );

    expect(returned.result).toEqual(
      f.session.result
    );

    expect(
      f.tx.update
    ).not.toHaveBeenCalled();
  });
});
