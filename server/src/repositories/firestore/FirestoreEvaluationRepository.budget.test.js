
"use strict";

const FirestoreEvaluationRepository = require(
  "./FirestoreEvaluationRepository"
);

// In-memory Firestore test double.
// Real concurrent transaction retries are verified separately.
function fixture({
  limit = 2,
  when = "2026-10-27T18:00:00.000Z",
} = {}) {
  const store = new Map();

  let now = new Date(when);

  const document = (path) => ({
    path,
    id: path.split("/").pop(),

    collection(name) {
      return {
        doc(id) {
          return document(
            `${path}/${name}/${id}`
          );
        },
      };
    },
  });

  const db = {
    collection(name) {
      return {
        doc(id) {
          return document(
            `${name}/${id}`
          );
        },
      };
    },

    runTransaction: jest.fn(async (work) => {
      const writes = [];

      const tx = {
        get: async (ref) => ({
          exists: store.has(ref.path),
          data: () => store.get(ref.path),
        }),

        set: (ref, value) =>
          writes.push([
            "set",
            ref.path,
            value,
          ]),

        update: (ref, value) =>
          writes.push([
            "update",
            ref.path,
            value,
          ]),
      };

      const result = await work(tx);

      for (const [
        kind,
        path,
        value,
      ] of writes) {
        store.set(
          path,
          kind === "set"
            ? value
            : {
                ...store.get(path),
                ...value,
              }
        );
      }

      return result;
    }),
  };

  function createSession(
    sessionId,
    userId = "user-1",
    mode = "Code Style"
  ) {
    const questionId =
      `${sessionId}-q1`;

    store.set(
      `sessions/${sessionId}`,
      {
        userId,
        status: "active",
        mode,
        assignmentStatus: "assigned",
        assignedQuestionIds: [questionId],
      }
    );

    return {
      userId,
      sessionId,
      questionId,
      mode,
      candidateResponse: "sample answer",
    };
  }

  const repo =
    new FirestoreEvaluationRepository({
      db,
      admin: null,
      dailyEvaluationLimit: limit,
      timeZone: "America/Los_Angeles",
      now: () => now,
    });

  return {
    repo,
    store,
    db,
    createSession,

    setTime: (date) => {
      now = new Date(date);
    },

    usage: (uid, key) =>
      store.get(
        `users/${uid}/evaluationUsage/${key}`
      ),
  };
}

describe("SEC-04 independent daily AI evaluation budget", () => {
  test("counts reservations across sessions and AI modes; rejects limit+1", async () => {
    const f = fixture({
      limit: 2,
    });

    const code =
      f.createSession("code-session");

    const theory =
      f.createSession(
        "theory-session",
        "user-1",
        "Theoretical Style"
      );

    const extra =
      f.createSession("extra-session");

    expect(
      (
        await f.repo.reserveEvaluation(code)
      ).kind
    ).toBe("reserved");

    expect(
      (
        await f.repo.reserveEvaluation(theory)
      ).kind
    ).toBe("reserved");

    await expect(
      f.repo.reserveEvaluation(extra)
    ).rejects.toMatchObject({
      statusCode: 429,
      code: "DAILY_EVALUATION_LIMIT_EXCEEDED",
    });

    expect(
      f.usage(
        "user-1",
        "2026-10-27"
      )
    ).toMatchObject({
      attemptsUsed: 2,
      codeEvaluationsUsed: 1,
      theoreticalEvaluationsUsed: 1,
      dateKey: "2026-10-27",
      timeZone: "America/Los_Angeles",
    });

    expect(
      f.store.has(
        "sessions/extra-session/evaluationAttempts/extra-session-q1"
      )
    ).toBe(false);
  });

  test("a processing duplicate is blocked without another budget debit", async () => {
    const f = fixture({
      limit: 1,
    });

    const input =
      f.createSession("one");

    await f.repo.reserveEvaluation(input);

    await expect(
      f.repo.reserveEvaluation({
        ...input,
        requestId: "retry",
      })
    ).rejects.toMatchObject({
      code: "EVALUATION_IN_PROGRESS",
    });

    expect(
      f.usage(
        "user-1",
        "2026-10-27"
      ).attemptsUsed
    ).toBe(1);
  });

  test("identical saved-grade replay is free even if the daily budget is exhausted", async () => {
    const f = fixture({
      limit: 1,
    });

    const input =
      f.createSession("one");

    const claim =
      await f.repo.reserveEvaluation(
        input
      );

    // SEC-04 Part 3:
    // Provider dispatch must occur before grade persistence.
    await f.repo.markProviderStarted({
      ...input,
      attemptId: claim.attemptId,
    });

    await f.repo.completeReservedEvaluation({
      ...input,
      attemptId: claim.attemptId,
      questionPrompt: "Question",
      evaluation: {
        score: 95,
      },
    });

    expect(
      await f.repo.reserveEvaluation({
        ...input,
        requestId: "again",
      })
    ).toEqual({
      kind: "replay",
      evaluation: {
        score: 95,
      },
    });

    expect(
      f.usage(
        "user-1",
        "2026-10-27"
      ).attemptsUsed
    ).toBe(1);
  });

  test("a reported provider failure still consumes one attempt", async () => {
    const f = fixture({
      limit: 1,
    });

    const input =
      f.createSession("one");

    const claim =
      await f.repo.reserveEvaluation(
        input
      );

    expect(
      await f.repo.failReservedEvaluation({
        ...input,
        attemptId: claim.attemptId,
      })
    ).toBe(true);

    await expect(
      f.repo.reserveEvaluation(input)
    ).rejects.toMatchObject({
      code: "DAILY_EVALUATION_LIMIT_EXCEEDED",
      statusCode: 429,
    });

    expect(
      f.usage(
        "user-1",
        "2026-10-27"
      ).attemptsUsed
    ).toBe(1);
  });

  test("each user has a separate daily budget and unauthorized callers cannot spend another user's budget", async () => {
    const f = fixture({
      limit: 1,
    });

    const a = f.createSession(
      "a",
      "user-a"
    );

    const b = f.createSession(
      "b",
      "user-b"
    );

    await expect(
      f.repo.reserveEvaluation({
        ...a,
        userId: "user-b",
      })
    ).rejects.toMatchObject({
      code: "SESSION_FORBIDDEN",
    });

    expect(
      f.usage(
        "user-b",
        "2026-10-27"
      )
    ).toBeUndefined();

    await f.repo.reserveEvaluation(a);
    await f.repo.reserveEvaluation(b);

    expect(
      f.usage(
        "user-a",
        "2026-10-27"
      ).attemptsUsed
    ).toBe(1);

    expect(
      f.usage(
        "user-b",
        "2026-10-27"
      ).attemptsUsed
    ).toBe(1);
  });

  test("the daily budget resets at midnight in the configured time zone", async () => {
    const f = fixture({
      limit: 1,
      when: "2026-10-28T06:59:00.000Z",
    });

    const a = f.createSession("before");
    const b = f.createSession("after");

    await f.repo.reserveEvaluation(a);

    expect(
      f.usage(
        "user-1",
        "2026-10-27"
      ).attemptsUsed
    ).toBe(1);

    f.setTime(
      "2026-10-28T07:01:00.000Z"
    );

    await f.repo.reserveEvaluation(b);

    expect(
      f.usage(
        "user-1",
        "2026-10-28"
      ).attemptsUsed
    ).toBe(1);
  });

  test("server-confirmed admins bypass the per-user budget, not question assignment", async () => {
    const f = fixture({
      limit: 1,
    });

    const a = f.createSession(
      "admin-a",
      "admin-user"
    );

    const b = f.createSession(
      "admin-b",
      "admin-user"
    );

    await f.repo.reserveEvaluation({
      ...a,
      role: "admin",
    });

    await f.repo.reserveEvaluation({
      ...b,
      role: "admin",
    });

    expect(
      f.usage(
        "admin-user",
        "2026-10-27"
      )
    ).toBeUndefined();

    await expect(
      f.repo.reserveEvaluation({
        ...a,
        role: "admin",
        questionId: "not-assigned",
      })
    ).rejects.toMatchObject({
      code: "QUESTION_NOT_ASSIGNED",
    });
  });

  test("corrupt budget state fails closed before any reservation write", async () => {
    const f = fixture();

    const input =
      f.createSession("one");

    f.store.set(
      "users/user-1/evaluationUsage/2026-10-27",
      {
        attemptsUsed: -1,
      }
    );

    await expect(
      f.repo.reserveEvaluation(input)
    ).rejects.toMatchObject({
      code: "EVALUATION_BUDGET_INVALID",
    });

    expect(
      f.store.has(
        "sessions/one/evaluationAttempts/one-q1"
      )
    ).toBe(false);
  });

  test("rejects invalid budget configuration at startup", () => {
    const f = fixture();

    expect(
      () =>
        new FirestoreEvaluationRepository({
          db: f.db,
          dailyEvaluationLimit: 0,
        })
    ).toThrow(/positive integer/i);
  });
});
