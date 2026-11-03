const FirestoreUserRepository = require("./FirestoreUserRepository");

describe("SCRUM-85 Firestore leaderboard projection", () => {
  test("reads only ranking and public profile fields with trusted document IDs", async () => {
    const get = jest.fn().mockResolvedValue({
      docs: [
        { id: "trusted-uid", data: () => ({
          uid: "forged-uid", username: "Alice",
          ranking: { points: 90, rankedSessions: 1, averageScore: 90 },
        }) },
      ],
    });
    const select = jest.fn(() => ({ get }));
    const collection = jest.fn(() => ({ select }));
    const repository = new FirestoreUserRepository({ db: { collection } });

    const result = await repository.listRankingProfiles();

    expect(collection).toHaveBeenCalledWith("users");
    expect(select).toHaveBeenCalledWith("username", "ranking", "deleting", "status");
    expect(get).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{ uid: "trusted-uid", username: "Alice", ranking: {
      points: 90, rankedSessions: 1, averageScore: 90,
    } }]);
  });

  test("returns an empty array for an empty collection", async () => {
    const get = jest.fn().mockResolvedValue({ docs: [] });
    const repository = new FirestoreUserRepository({
      db: { collection: jest.fn(() => ({ select: jest.fn(() => ({ get })) })) },
    });
    expect(await repository.listRankingProfiles()).toEqual([]);
  });
});