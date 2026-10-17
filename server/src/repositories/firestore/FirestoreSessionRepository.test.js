
const FirestoreSessionRepository = require(
  "./FirestoreSessionRepository"
);

const TEST_USER_ID = "user-123";
const TEST_SESSION_ID = "session-123";

const createTestSession = (overrides = {}) => ({
  userId: TEST_USER_ID,
  mode: "technical",
  jobRole: "Software Engineer",
  experienceLevel: "entry",
  status: "active",
  createdAt: "CREATED_TIMESTAMP",
  updatedAt: "UPDATED_TIMESTAMP",
  completedAt: null,
  ...overrides,
});

describe("FirestoreSessionRepository", () => {
  let repository;
  let db;
  let collection;
  let docRef;
  let transaction;

  beforeEach(() => {
    docRef = {
      id: TEST_SESSION_ID,
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

  test("creates an active session with the expected fields", async () => {
    collection.add.mockResolvedValue({ id: TEST_SESSION_ID });

    const result = await repository.createSession({
      userId: TEST_USER_ID,
      mode: "technical",
      jobRole: "Software Engineer",
      experienceLevel: "entry",
    });

    expect(db.collection).toHaveBeenCalledWith("sessions");
    expect(collection.add).toHaveBeenCalledWith({
      userId: TEST_USER_ID,
      mode: "technical",
      jobRole: "Software Engineer",
      experienceLevel: "entry",
      status: "active",
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      completedAt: null,
    });

    expect(result).toEqual({
      id: TEST_SESSION_ID,
      ...collection.add.mock.calls[0][0],
    });
  });

  test("uses Firebase server timestamps when Admin is available", async () => {
    const serverTimestamp = jest.fn(() => "SERVER_TIMESTAMP");
    const firebaseAdmin = {
      firestore: {
        FieldValue: { serverTimestamp },
      },
    };

    repository = new FirestoreSessionRepository({
      db,
      admin: firebaseAdmin,
    });
    collection.add.mockResolvedValue({ id: TEST_SESSION_ID });

    const result = await repository.createSession({
      userId: TEST_USER_ID,
      mode: "technical",
    });

    expect(collection.add).toHaveBeenCalledWith(
      expect.objectContaining({
        jobRole: null,
        experienceLevel: null,
        createdAt: "SERVER_TIMESTAMP",
        updatedAt: "SERVER_TIMESTAMP",
      })
    );
    expect(result.createdAt).toBe("SERVER_TIMESTAMP");
    expect(serverTimestamp).toHaveBeenCalledTimes(2);
  });

  test("rejects creating a session without required fields", async () => {
    await expect(
      repository.createSession({ userId: null, mode: "technical" })
    ).rejects.toThrow("userId and mode are required.");

    await expect(
      repository.createSession({ userId: TEST_USER_ID, mode: null })
    ).rejects.toThrow("userId and mode are required.");

    expect(collection.add).not.toHaveBeenCalled();
  });

  test("finds an existing session by ID", async () => {
    const savedData = createTestSession();
    docRef.get.mockResolvedValue({
      exists: true,
      id: TEST_SESSION_ID,
      data: () => savedData,
    });

    const result = await repository.findById(TEST_SESSION_ID);

    expect(collection.doc).toHaveBeenCalledWith(TEST_SESSION_ID);
    expect(result).toEqual({ id: TEST_SESSION_ID, ...savedData });
  });

  test("returns null when a session does not exist", async () => {
    docRef.get.mockResolvedValue({ exists: false });

    await expect(repository.findById("missing")).resolves.toBeNull();
  });

  test("rejects finding a session without an ID", async () => {
    await expect(repository.findById(null)).rejects.toThrow(
      "sessionId is required."
    );
    expect(collection.doc).not.toHaveBeenCalled();
  });

  test("lists all sessions for a user using newest-first query", async () => {
    const firstSession = createTestSession();
    const secondSession = createTestSession({
      mode: "behavioral",
      status: "completed",
    });

    collection.get.mockResolvedValue({
      docs: [
        { id: "session-1", data: () => firstSession },
        { id: "session-2", data: () => secondSession },
      ],
    });

    const result = await repository.listByUser(TEST_USER_ID);

    expect(collection.where).toHaveBeenCalledWith(
      "userId",
      "==",
      TEST_USER_ID
    );
    expect(collection.orderBy).toHaveBeenCalledWith(
      "createdAt",
      "desc"
    );
    expect(result).toEqual([
      { id: "session-1", ...firstSession },
      { id: "session-2", ...secondSession },
    ]);
  });

  test("rejects listing sessions without a user ID", async () => {
    await expect(repository.listByUser(null)).rejects.toThrow(
      "userId is required."
    );
    expect(collection.where).not.toHaveBeenCalled();
  });

  test("completes an active session using a transaction", async () => {
    const existingData = createTestSession();
    transaction.get.mockResolvedValue({
      exists: true,
      id: TEST_SESSION_ID,
      data: () => existingData,
    });

    const result = await repository.completeSession(TEST_SESSION_ID);

    expect(collection.doc).toHaveBeenCalledWith(TEST_SESSION_ID);
    expect(db.runTransaction).toHaveBeenCalledTimes(1);
    expect(transaction.get).toHaveBeenCalledWith(docRef);
    expect(transaction.update).toHaveBeenCalledWith(
      docRef,
      expect.objectContaining({
        status: "completed",
        completedAt: expect.any(String),
        updatedAt: expect.any(String),
      })
    );
    expect(result).toEqual({
      id: TEST_SESSION_ID,
      ...existingData,
      status: "completed",
    });
  });

  test("does not update an already completed session", async () => {
    const completedData = createTestSession({
      status: "completed",
      completedAt: "PREVIOUS_TIMESTAMP",
    });
    transaction.get.mockResolvedValue({
      exists: true,
      id: TEST_SESSION_ID,
      data: () => completedData,
    });

    const result = await repository.completeSession(TEST_SESSION_ID);

    expect(result).toEqual({ id: TEST_SESSION_ID, ...completedData });
    expect(transaction.update).not.toHaveBeenCalled();
  });

  test("returns null when completing a missing session", async () => {
    transaction.get.mockResolvedValue({ exists: false });

    await expect(
      repository.completeSession("missing")
    ).resolves.toBeNull();
    expect(transaction.update).not.toHaveBeenCalled();
  });

  test("rejects completing a session without an ID", async () => {
    await expect(repository.completeSession(null)).rejects.toThrow(
      "sessionId is required."
    );
    expect(db.runTransaction).not.toHaveBeenCalled();
  });
});
