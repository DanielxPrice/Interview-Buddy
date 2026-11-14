const FirestoreUserRepository = require("./FirestoreUserRepository");
const { ELO_CONFIG } = require("../../services/eloRating");

// Read-only Firestore test double: all ELO writes remain in the separate,
// existing SCRUM-112 session-completion transaction tests.
function fixture(savedDocument) {
  const get = jest.fn().mockResolvedValue(savedDocument == null
    ? { exists: false, id: "user-1" }
    : { exists: true, id: "user-1", data: () => savedDocument });
  const db = { collection: jest.fn(() => ({ doc: jest.fn(() => ({ get })) })) };
  return { repository: new FirestoreUserRepository({ db }), db, get };
}

describe("SCRUM-117 ELO user-profile read compatibility", () => {
  test("returns the stored rating from the canonical ranking.elo field", async () => {
    const { repository } = fixture({ ranking: { points: 50, elo: 1450 } });
    await expect(repository.getElo("user-1")).resolves.toBe(1450);
  });

  test("preserves a real saved ELO of zero", async () => {
    const { repository } = fixture({ ranking: { elo: 0 } });
    await expect(repository.getElo("user-1")).resolves.toBe(0);
  });

  test.each([
    { ranking: { points: 130 } },
    { ranking: { points: 130, elo: null } },
    { username: "legacy-account" },
  ])("treats legacy profiles without ELO as initial rating: %p", async (user) => {
    const { repository } = fixture(user);
    await expect(repository.getElo("user-1")).resolves.toBe(ELO_CONFIG.initialElo);
  });

  test("returns null for an absent user or empty identifier", async () => {
    const { repository, get } = fixture(null);
    await expect(repository.getElo("user-1")).resolves.toBeNull();
    await expect(repository.getElo("  ")).resolves.toBeNull();
    expect(get).toHaveBeenCalledTimes(1);
  });

  test.each([
    { ranking: { elo: "1200" } },
    { ranking: { elo: -1 } },
    { ranking: { elo: 1.25 } },
    { ranking: { elo: Number.POSITIVE_INFINITY } },
    { ranking: [] },
    { ranking: "invalid" },
  ])("rejects corrupted stored ELO data instead of silently resetting it: %p", async (user) => {
    const { repository } = fixture(user);
    await expect(repository.getElo("user-1")).rejects.toMatchObject({
      code: "ELO_DATA_INVALID",
      statusCode: 503,
    });
  });

  test("ELO reads never write or migrate profiles", async () => {
    const { repository, db } = fixture({ ranking: { points: 200 } });
    await expect(repository.getElo("user-1")).resolves.toBe(1000);
    expect(db.collection).toHaveBeenCalledWith("users");
    expect(db.collection).toHaveBeenCalledTimes(1);
  });
});
