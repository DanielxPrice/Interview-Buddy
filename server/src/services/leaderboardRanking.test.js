const { rankProfiles, GLOBAL_LEADERBOARD_LIMIT } = require("./leaderboardRanking");

const person = (uid, username, points, rankedSessions = 1) => ({
  uid, username,
  ranking: {
    points,
    rankedSessions,
    averageScore: Math.round((points / rankedSessions) * 100) / 100,
  },
});

describe("SCRUM-85 points-based ranking", () => {
  test("orders highest points first and assigns competition rank", () => {
    const rankings = rankProfiles([
      person("c", "Zoe", 45),
      person("b", "Bob", 90),
      person("a", "Amy", 90),
      person("d", "Dan", 30),
    ]);
    expect(rankings.map((row) => [row.uid, row.rank])).toEqual([
      ["a", 1], ["b", 1], ["c", 3], ["d", 4],
    ]);
  });

  test("ties with equal username use UID for stable ordering", () => {
    expect(rankProfiles([person("z", "Sam", 50), person("a", "sam", 50)])
      .map((row) => row.uid)).toEqual(["a", "z"]);
  });

  test("ignores new accounts with zero ranked sessions", () => {
    const rows = [
      { uid: "fresh", username: "Fresh", ranking: { points: 0, rankedSessions: 0, averageScore: 0 } },
      person("scored", "Scored", 0),
    ];
    expect(rankProfiles(rows).map((row) => row.uid)).toEqual(["scored"]);
  });

  test("skips missing, malformed and inconsistent ranking records", () => {
    const rows = [
      { uid: "noRanking", username: "Missing" },
      person("invalid", "Negative", -5),
      { uid: "badAverage", username: "Bad", ranking: { points: 80, rankedSessions: 1, averageScore: 99 } },
      { uid: "overMax", username: "Over", ranking: { points: 101, rankedSessions: 1, averageScore: 100 } },
      { uid: "nonNumber", username: "Nonnumeric", ranking: { points: "90", rankedSessions: 1, averageScore: 90 } },
      person("valid", "Valid", 90),
    ];
    expect(rankProfiles(rows).map((row) => row.uid)).toEqual(["valid"]);
  });

  test("excludes deleting accounts and blank usernames", () => {
    const deleting = { ...person("delete", "Deleted", 90), deleting: true };
    const deletingStatus = { ...person("status", "Gone", 80), status: "deleting" };
    const missingUsername = person("empty", "  ", 70);
    expect(rankProfiles([deleting, deletingStatus, missingUsername])).toEqual([]);
  });

  test("allows zero-point completed sessions", () => {
    const [entry] = rankProfiles([person("zero", "Zero", 0)]);
    expect(entry).toMatchObject({ rank: 1, points: 0, rankedSessions: 1 });
  });

  test("never labels points as final ELO", () => {
    const [entry] = rankProfiles([person("u", "User", 100)]);
    expect(entry).toMatchObject({ points: 100, elo: null, rank: 1 });
    expect(entry).not.toHaveProperty("email");
    expect(entry).not.toHaveProperty("role");
  });

  test("removes private user fields", () => {
    const [entry] = rankProfiles([{ ...person("u", "User", 50), email: "private@example.com", role: "admin", settings: { theme: "dark" } }]);
    expect(Object.keys(entry).sort()).toEqual(
      ["uid", "username", "points", "rankedSessions", "averageScore", "rank", "elo"].sort()
    );
  });

  test("requires an array of profiles", () => {
    expect(() => rankProfiles(null)).toThrow("Ranking profiles must be an array.");
  });

  test("defines a bounded global response size", () => {
    expect(GLOBAL_LEADERBOARD_LIMIT).toBe(50);
  });
});