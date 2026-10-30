
"use strict";

const FirestoreEvaluationRepository = require(
  "./FirestoreEvaluationRepository"
);

function fixture() {
  const store = new Map();

  const session = {
    userId: "user-1",
    status: "active",
    mode: "Code Style",
    assignmentStatus: "assigned",
    assignedQuestionIds: ["code-1"],
  };

  store.set(
    "sessions/session-1",
    session
  );

  const ref = (path) => ({
    path,
    id: path.split("/").pop(),

    collection(name) {
      return {
        doc(id) {
          return ref(
            `${path}/${name}/${id}`
          );
        },
      };
    },
  });

  const writes = [];

  const db = {
    collection(name) {
      return {
        doc(id) {
          return ref(
            `${name}/${id}`
          );
        },
      };
    },

    async runTransaction(callback) {
      const staged = [];

      const tx = {
        get: async (reference) => ({
          exists: store.has(reference.path),
          data: () => store.get(reference.path),
        }),

        set: (reference, value) =>
          staged.push([
            "set",
            reference.path,
            value,
          ]),

        update: (reference, value) =>
          staged.push([
            "update",
            reference.path,
            value,
          ]),
      };

      const result = await callback(tx);

      for (const [
        operation,
        path,
        value,
      ] of staged) {
        const prior = store.get(path) || {};

        store.set(
          path,
          operation === "set"
            ? value
            : {
                ...prior,
                ...value,
              }
        );

        writes.push({
          operation,
          path,
        });
      }

      return result;
    },
  };

  const repo =
    new FirestoreEvaluationRepository({
      db,
      admin: null,
    });

  const input = {
    userId: "user-1",
    sessionId: "session-1",
    questionId: "code-1",
    mode: "Code Style",
    candidateResponse: "return 42;",
    requestId: "first",
  };

  return {
    repo,
    input,
    store,
    writes,
    session,
  };
}

describe("SEC-04 Firestore reservation integrity", () => {
  test("first claim is durable; parallel/repeat claim cannot call provider", async () => {
    const f = fixture();

    const first =
      await f.repo.reserveEvaluation(
        f.input
      );

    expect(first.kind).toBe(
      "reserved"
    );

    expect(
      first.attemptId
    ).toBeTruthy();

    await expect(
      f.repo.reserveEvaluation({
        ...f.input,
        requestId: "different",
      })
    ).rejects.toMatchObject({
      code: "EVALUATION_IN_PROGRESS",
      statusCode: 409,
    });

    expect(
      f.store.get(
        "sessions/session-1/evaluationAttempts/code-1"
      ).state
    ).toBe("processing");
  });

  test("successful reserved write returns saved grade on identical replay", async () => {
    const f = fixture();

    const admission =
      await f.repo.reserveEvaluation(
        f.input
      );

    // SEC-04 Part 3 requires a provider dispatch marker.
    await f.repo.markProviderStarted({
      ...f.input,
      attemptId: admission.attemptId,
    });

    await f.repo.completeReservedEvaluation({
      ...f.input,
      attemptId: admission.attemptId,
      questionPrompt: "Return 42",
      evaluation: {
        score: 90,
      },
    });

    const replay =
      await f.repo.reserveEvaluation({
        ...f.input,
        requestId: "retry",
      });

    expect(replay).toEqual({
      kind: "replay",
      evaluation: {
        score: 90,
      },
    });

    expect(
      f.store.get(
        "sessions/session-1/responses/code-1"
      ).candidateResponse
    ).toBe("return 42;");

    expect(
      f.store.get(
        "sessions/session-1/evaluationAttempts/code-1"
      ).state
    ).toBe("completed");

    await expect(
      f.repo.reserveEvaluation({
        ...f.input,
        candidateResponse: "return 0;",
      })
    ).rejects.toMatchObject({
      code: "QUESTION_ALREADY_ANSWERED",
    });
  });

  test("another owner and unassigned questions cannot reserve", async () => {
    const f = fixture();

    await expect(
      f.repo.reserveEvaluation({
        ...f.input,
        userId: "other",
      })
    ).rejects.toMatchObject({
      code: "SESSION_FORBIDDEN",
    });

    await expect(
      f.repo.reserveEvaluation({
        ...f.input,
        questionId: "not-assigned",
      })
    ).rejects.toMatchObject({
      code: "QUESTION_NOT_ASSIGNED",
    });

    expect(f.writes).toEqual([]);
  });

  test("a stale or forged attempt cannot persist an evaluation", async () => {
    const f = fixture();

    const admission =
      await f.repo.reserveEvaluation(
        f.input
      );

    await expect(
      f.repo.completeReservedEvaluation({
        ...f.input,
        attemptId: "fake",
        evaluation: {
          score: 100,
        },
      })
    ).rejects.toMatchObject({
      code: "EVALUATION_RESERVATION_INVALID",
    });

    expect(
      f.store.has(
        "sessions/session-1/responses/code-1"
      )
    ).toBe(false);

    await f.repo.markProviderStarted({
      ...f.input,
      attemptId: admission.attemptId,
    });

    await f.repo.completeReservedEvaluation({
      ...f.input,
      attemptId: admission.attemptId,
      evaluation: {
        score: 80,
      },
    });

    await expect(
      f.repo.completeReservedEvaluation({
        ...f.input,
        attemptId: admission.attemptId,
        evaluation: {
          score: 100,
        },
      })
    ).rejects.toMatchObject({
      code: "QUESTION_ALREADY_ANSWERED",
    });
  });

  test("failed provider evaluation frees the reservation but limits repeated attempts", async () => {
    const f = fixture();

    for (
      let n = 0;
      n < 3;
      n += 1
    ) {
      const admission =
        await f.repo.reserveEvaluation(
          f.input
        );

      // Represents a safely failed pre-dispatch attempt.
      const released =
        await f.repo.failReservedEvaluation({
          ...f.input,
          attemptId: admission.attemptId,
        });

      expect(released).toBe(true);
    }

    await expect(
      f.repo.reserveEvaluation(
        f.input
      )
    ).rejects.toMatchObject({
      statusCode: 429,
      code: "EVALUATION_ATTEMPT_LIMIT",
    });
  });

  test("a late failure from an earlier attempt cannot release a newer attempt", async () => {
    const f = fixture();

    const first =
      await f.repo.reserveEvaluation(
        f.input
      );

    await f.repo.failReservedEvaluation({
      ...f.input,
      attemptId: first.attemptId,
    });

    const second =
      await f.repo.reserveEvaluation(
        f.input
      );

    expect(
      await f.repo.failReservedEvaluation({
        ...f.input,
        attemptId: first.attemptId,
      })
    ).toBe(false);

    expect(
      f.store.get(
        "sessions/session-1/evaluationAttempts/code-1"
      ).attemptId
    ).toBe(second.attemptId);

    expect(
      f.store.get(
        "sessions/session-1/evaluationAttempts/code-1"
      ).state
    ).toBe("processing");
  });

  test("session completion during AI prevents saving another response", async () => {
    const f = fixture();

    const admission =
      await f.repo.reserveEvaluation(
        f.input
      );

    f.session.status = "completed";

    await expect(
      f.repo.completeReservedEvaluation({
        ...f.input,
        attemptId: admission.attemptId,
        evaluation: {
          score: 90,
        },
      })
    ).rejects.toMatchObject({
      code: "SESSION_NOT_ACTIVE",
    });
  });
});
