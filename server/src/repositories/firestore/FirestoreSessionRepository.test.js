
const FirestoreSessionRepository = require(
  "./FirestoreSessionRepository"
);

describe("FirestoreSessionRepository", () => {
  let repository;
  let db;
  let collection;
  let docRef;
  let transaction;

  beforeEach(() => {
    docRef = {
      id: "session-123",
      get: jest.fn(),
    };

    collection = {
      add: jest.fn(),
      doc: jest.fn(() => docRef),
      where: jest.fn(),
      orderBy: jest.fn(),
      get: jest.fn(),
    };

    collection.where.mockReturnValue(collection);
    collection.orderBy.mockReturnValue(collection);

    transaction = {
      get: jest.fn(),
      update: jest.fn(),
    };

    db = {
      collection: jest.fn(() => collection),
      runTransaction: jest.fn(async (callback) =>
        callback(transaction)
      ),
    };

    repository = new FirestoreSessionRepository({
      db,
      admin: null,
    });
  });

  test("rejects missing Firestore database", () => {
    expect(() =>
      new FirestoreSessionRepository({ db: null })
    ).toThrow("requires a Firestore db instance");
  });

  test("creates a session with the correct fields", async () => {
    collection.add.mockResolvedValue({
      id: "session-123",
    });

    const result = await repository.createSession({
      userId: "user-123",
      mode: "technical",
      jobRole: "Software Engineer",
      experienceLevel: "entry",
    });

    expect(collection.add).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-123",
        mode: "technical",
        status: "active",
        completedAt: null,
      })
    );

    expect(result.id).toBe("session-123");
    expect(result.status).toBe("active");
  });

  test("rejects creating a session without required fields", async () => {
    await expect(
      repository.createSession({
        userId: null,
        mode: "technical",
      })
    ).rejects.toThrow();

    expect(collection.add).not.toHaveBeenCalled();
  });

  test("finds an existing session", async () => {
    docRef.get.mockResolvedValue({
      exists: true,
      id: "session-123",
      data: () => ({
        userId: "user-123",
        status: "active",
      }),
    });

    const result = await repository.findById("session-123");

    expect(result).toEqual({
      id: "session-123",
      userId: "user-123",
      status: "active",
    });
  });

  test("returns null for a missing session", async () => {
    docRef.get.mockResolvedValue({
      exists: false,
    });

    const result = await repository.findById("missing");

    expect(result).toBeNull();
  });

  test("lists sessions belonging to a user, newest first", async () => {
    collection.get.mockResolvedValue({
      docs: [
        {
          id: "session-123",
          data: () => ({ userId: "user-123" }),
        },
      ],
    });

    const result = await repository.listByUser("user-123");

    expect(collection.where).toHaveBeenCalledWith(
      "userId",
      "==",
      "user-123"
    );

    expect(collection.orderBy).toHaveBeenCalledWith(
      "createdAt",
      "desc"
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("session-123");
  });

  test("completes an active session", async () => {
    transaction.get.mockResolvedValue({
      exists: true,
      id: "session-123",
      data: () => ({
        userId: "user-123",
        status: "active",
      }),
    });

    const result = await repository.completeSession(
      "session-123"
    );

    expect(transaction.update).toHaveBeenCalledWith(
      docRef,
      expect.objectContaining({
        status: "completed",
        completedAt: expect.any(String),
        updatedAt: expect.any(String),
      })
    );

    expect(result.status).toBe("completed");
  });

  test("does not complete an already completed session again", async () => {
    transaction.get.mockResolvedValue({
      exists: true,
      id: "session-123",
      data: () => ({
        status: "completed",
      }),
    });

    const result = await repository.completeSession(
      "session-123"
    );

    expect(result.status).toBe("completed");
    expect(transaction.update).not.toHaveBeenCalled();
  });

  test("returns null when completing a missing session", async () => {
    transaction.get.mockResolvedValue({
      exists: false,
    });

    const result = await repository.completeSession(
      "missing"
    );

    expect(result).toBeNull();
    expect(transaction.update).not.toHaveBeenCalled();
  });
});
