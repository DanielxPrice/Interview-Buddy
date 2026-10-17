
const FirestoreEvaluationRepository = require(
  "./FirestoreEvaluationRepository"
);

describe("FirestoreEvaluationRepository", () => {
  let repository;
  let db;
  let transaction;
  let sessionRef;
  let responseRef;

  const evaluationData = {
    sessionId: "session-123",
    questionId: "question-123",
    questionPrompt: "Explain closures.",
    mode: "Theoretical Style",
    candidateResponse: "My answer",
    evaluation: {
      score: 85,
      feedback: "Good answer.",
    },
    evaluatedAt: "2026-10-13T12:00:00.000Z",
  };

  beforeEach(() => {
    responseRef = {
      id: "question-123",
    };

    sessionRef = {
      id: "session-123",
      collection: jest.fn().mockReturnValue({
        doc: jest.fn().mockReturnValue(responseRef),
      }),
    };

    db = {
      collection: jest.fn().mockReturnValue({
        doc: jest.fn().mockReturnValue(sessionRef),
      }),
      runTransaction: jest.fn(),
    };

    transaction = {
      get: jest.fn(),
      update: jest.fn(),
      set: jest.fn(),
    };

    db.runTransaction.mockImplementation(async (callback) =>
      callback(transaction)
    );

    transaction.get.mockResolvedValue({
      exists: true,
      data: () => ({
        userId: "test-user",
        status: "active",
      }),
    });

    repository = new FirestoreEvaluationRepository({
      db,
      admin: null,
    });
  });

  test("saves an evaluation to an active session", async () => {
    await repository.saveEvaluation(evaluationData);

    expect(transaction.update).toHaveBeenCalledWith(
      sessionRef,
      {
        updatedAt: evaluationData.evaluatedAt,
      }
    );

    expect(transaction.set).toHaveBeenCalledWith(
      responseRef,
      expect.objectContaining({
        questionId: "question-123",
        candidateResponse: "My answer",
        evaluation: evaluationData.evaluation,
      }),
      { merge: true }
    );
  });

  test("rejects a nonexistent session", async () => {
    transaction.get.mockResolvedValue({
      exists: false,
    });

    await expect(
      repository.saveEvaluation(evaluationData)
    ).rejects.toMatchObject({
      message: "Session not found.",
      statusCode: 404,
    });

    expect(transaction.set).not.toHaveBeenCalled();
    expect(transaction.update).not.toHaveBeenCalled();
  });

  test("rejects a completed session", async () => {
    transaction.get.mockResolvedValue({
      exists: true,
      data: () => ({
        status: "completed",
      }),
    });

    await expect(
      repository.saveEvaluation(evaluationData)
    ).rejects.toMatchObject({
      message: "This session is not active.",
      statusCode: 409,
    });

    expect(transaction.set).not.toHaveBeenCalled();
    expect(transaction.update).not.toHaveBeenCalled();
  });

  test("requires a session ID and question ID", async () => {
    await expect(
      repository.saveEvaluation({
        ...evaluationData,
        sessionId: null,
      })
    ).rejects.toThrow(
      "sessionId and questionId are required"
    );

    expect(db.runTransaction).not.toHaveBeenCalled();
  });
});
