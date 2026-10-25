
const FirestoreSessionRepository = require(
  "./FirestoreSessionRepository"
);

function fixture(mode = "Quiz Style") {
  const responseRef = { id: "quiz-1" };

  const responseCollection = {
    doc: jest.fn(() => responseRef),
  };

  const sessionRef = {
    id: "session-1",
    collection: jest.fn(() => responseCollection),
  };

  const collection = {
    doc: jest.fn(() => sessionRef),
  };

  const tx = {
    get: jest.fn(),
    set: jest.fn(),
    update: jest.fn(),
  };

  const db = {
    collection: jest.fn(() => collection),
    runTransaction: jest.fn(async (callback) => callback(tx)),
  };

  const repository = new FirestoreSessionRepository({
    db,
    admin: null,
  });

  const session = {
    userId: "user-1",
    status: "active",
    mode,
  };

  const sessionSnapshot = {
    exists: true,
    id: "session-1",
    data: () => session,
  };

  const existingAnswer = {
    exists: false,
  };

  const responses = {
    docs: [],
  };

  tx.get.mockImplementation(async (ref) => {
    if (ref === sessionRef) return sessionSnapshot;
    if (ref === responseRef) return existingAnswer;
    if (ref === responseCollection) return responses;
    throw new Error("Unexpected transaction read");
  });

  return {
    repository,
    tx,
    session,
    sessionSnapshot,
    existingAnswer,
    responses,
    sessionRef,
    responseRef,
    db,
  };
}

const question = {
  id: "quiz-1",
  prompt: "Pick one",
  mode: "Quiz Style",
  active: true,
  options: ["A", "B"],
  correctAnswer: "A",
  explanation: "A is correct.",
};

describe("SCRUM-82 server-side results persistence", () => {
  test("saves a correct Quiz response and 100-point evaluation", async () => {
    const f = fixture();

    const result = await f.repository.saveQuizAnswer({
      sessionId: "session-1",
      userId: "user-1",
      question,
      answer: "A",
    });

    expect(result).toEqual({
      questionId: "quiz-1",
      isCorrect: true,
      explanation: "A is correct.",
    });

    expect(f.tx.set).toHaveBeenCalledWith(
      f.responseRef,
      expect.objectContaining({
        candidateResponse: "A",
        evaluation: {
          score: 100,
          isCorrect: true,
          feedback: "A is correct.",
        },
      })
    );

    expect(f.tx.update).toHaveBeenCalledWith(
      f.sessionRef,
      { updatedAt: expect.any(String) }
    );
  });

  test("saves an incorrect Quiz response with zero score", async () => {
    const f = fixture();

    await f.repository.saveQuizAnswer({
      sessionId: "session-1",
      userId: "user-1",
      question,
      answer: "B",
    });

    expect(f.tx.set.mock.calls[0][1].evaluation.score).toBe(0);
  });

  test("rejects answers for another user's session", async () => {
    const f = fixture();

    await expect(
      f.repository.saveQuizAnswer({
        sessionId: "session-1",
        userId: "user-2",
        question,
        answer: "A",
      })
    ).rejects.toMatchObject({
      statusCode: 403,
    });

    expect(f.tx.set).not.toHaveBeenCalled();
  });

  test("blocks duplicate answers and does not overwrite a score", async () => {
    const f = fixture();
    f.existingAnswer.exists = true;

    await expect(
      f.repository.saveQuizAnswer({
        sessionId: "session-1",
        userId: "user-1",
        question,
        answer: "B",
      })
    ).rejects.toMatchObject({
      statusCode: 409,
    });

    expect(f.tx.set).not.toHaveBeenCalled();
  });

  test("does not write an answer after completion", async () => {
    const f = fixture();
    f.session.status = "completed";

    await expect(
      f.repository.saveQuizAnswer({
        sessionId: "session-1",
        userId: "user-1",
        question,
        answer: "A",
      })
    ).rejects.toMatchObject({
      statusCode: 409,
    });

    expect(f.tx.set).not.toHaveBeenCalled();
  });

  test("rejects unlisted Quiz options", async () => {
    const f = fixture();

    await expect(
      f.repository.saveQuizAnswer({
        sessionId: "session-1",
        userId: "user-1",
        question,
        answer: "not an option",
      })
    ).rejects.toMatchObject({
      statusCode: 400,
    });

    expect(f.db.runTransaction).not.toHaveBeenCalled();
  });

  test.each([
    "Quiz Style",
    "Code Style",
    "Theoretical Style",
  ])(
    "finalizes %s with a server-calculated average from stored responses",
    async (mode) => {
      const f = fixture(mode);

      f.responses.docs = [
        {
          data: () => ({
            mode,
            evaluation: { score: 100 },
          }),
        },
        {
          data: () => ({
            mode,
            evaluation: { score: 70 },
          }),
        },
      ];

      const completed = await f.repository.finalizeSessionWithResults(
        "session-1",
        "user-1"
      );

      expect(completed.result).toEqual({
        score: 85,
        questionsAnswered: 2,
        totalScore: 170,
      });

      expect(f.tx.update).toHaveBeenCalledWith(
        f.sessionRef,
        expect.objectContaining({
          status: "completed",
          result: completed.result,
          completedAt: expect.any(String),
        })
      );
    }
  );

  test("finalizing an empty session saves a zero-response summary", async () => {
    const f = fixture();

    const completed = await f.repository.finalizeSessionWithResults(
      "session-1",
      "user-1"
    );

    expect(completed.result).toEqual({
      score: 0,
      questionsAnswered: 0,
      totalScore: 0,
    });
  });

  test("finalization refuses invalid saved scores without changing status", async () => {
    const f = fixture("Code Style");

    f.responses.docs = [
      {
        data: () => ({
          mode: "Code Style",
          evaluation: { score: 120 },
        }),
      },
    ];

    await expect(
      f.repository.finalizeSessionWithResults("session-1", "user-1")
    ).rejects.toMatchObject({
      statusCode: 409,
    });

    expect(f.tx.update).not.toHaveBeenCalled();
  });

  test("finalization checks ownership inside the transaction", async () => {
    const f = fixture();

    await expect(
      f.repository.finalizeSessionWithResults("session-1", "user-2")
    ).rejects.toMatchObject({
      statusCode: 403,
    });

    expect(f.tx.update).not.toHaveBeenCalled();
  });

  test("repeated completion returns the original result without rewriting it", async () => {
    const f = fixture();

    f.session.status = "completed";
    f.session.result = {
      score: 75,
      questionsAnswered: 1,
      totalScore: 75,
    };

    const completed = await f.repository.finalizeSessionWithResults(
      "session-1",
      "user-1"
    );

    expect(completed.result.score).toBe(75);
    expect(f.tx.update).not.toHaveBeenCalled();
    expect(f.tx.get).toHaveBeenCalledTimes(1);
  });
});
