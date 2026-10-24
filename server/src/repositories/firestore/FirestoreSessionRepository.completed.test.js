
const FirestoreSessionRepository = require("./FirestoreSessionRepository");

describe("FirestoreSessionRepository completed-session queries", () => {
  let repository;
  let collection;

  beforeEach(() => {
    collection = {
      where: jest.fn(),
      orderBy: jest.fn(),
      get: jest.fn(),
    };

    collection.where.mockReturnValue(collection);
    collection.orderBy.mockReturnValue(collection);

    const db = {
      collection: jest.fn(() => collection),
    };

    repository = new FirestoreSessionRepository({
      db,
      admin: null,
    });
  });

  test("queries only the signed-in user's completed sessions, newest first", async () => {
    const newest = {
      userId: "user-A",
      status: "completed",
      completedAt: "2026-10-22T18:00:00Z",
    };

    const older = {
      userId: "user-A",
      status: "completed",
      completedAt: "2026-10-21T18:00:00Z",
    };

    collection.get.mockResolvedValue({
      docs: [
        { id: "session-new", data: () => newest },
        { id: "session-old", data: () => older },
      ],
    });

    const result = await repository.listCompletedByUser("user-A");

    expect(collection.where).toHaveBeenNthCalledWith(
      1, "userId", "==", "user-A"
    );

    expect(collection.where).toHaveBeenNthCalledWith(
      2, "status", "==", "completed"
    );

    expect(collection.orderBy).toHaveBeenCalledWith(
      "completedAt", "desc"
    );

    expect(result).toEqual([
      { id: "session-new", ...newest },
      { id: "session-old", ...older },
    ]);
  });

  test("returns an empty list for users with no completed sessions", async () => {
    collection.get.mockResolvedValue({ docs: [] });

    await expect(
      repository.listCompletedByUser("user-A")
    ).resolves.toEqual([]);
  });

  test("rejects a missing user ID before querying Firestore", async () => {
    await expect(
      repository.listCompletedByUser(null)
    ).rejects.toThrow("userId is required.");

    expect(collection.where).not.toHaveBeenCalled();
  });

  test("propagates Firestore failures instead of pretending history is empty", async () => {
    collection.get.mockRejectedValue(
      new Error("Firestore query failed")
    );

    await expect(
      repository.listCompletedByUser("user-A")
    ).rejects.toThrow("Firestore query failed");
  });
});
