"use strict";
const { rankProfiles, GLOBAL_LEADERBOARD_LIMIT } = require("./leaderboardRanking");
const person = (uid, username, elo, rankedSessions = 1, points = 90) => ({
  uid, username, ranking: { elo, rankedSessions, points,
    averageScore: rankedSessions ? points / rankedSessions : 0 },
});

describe("ELO-based global rankings", () => {
  test("orders highest ELO first even if historical points disagree", () => {
    const rankings = rankProfiles([
      person("c", "Zoe", 950, 4, 400),
      person("b", "Bob", 1200, 1, 40),
      person("a", "Amy", 1200, 1, 25),
      person("d", "Dan", 900, 2, 190),
    ]);
    expect(rankings.map((row) => [row.uid, row.rank, row.elo])).toEqual([
      ["a", 1, 1200], ["b", 1, 1200], ["c", 3, 950], ["d", 4, 900],
    ]);
  });

  test("equal username and ELO use UID for deterministic ordering", () => {
    expect(rankProfiles([person("z", "Sam", 1000), person("a", "sam", 1000)])
      .map((row) => row.uid)).toEqual(["a", "z"]);
  });

  test("new accounts without a ranked interview are excluded", () => {
    expect(rankProfiles([person("fresh", "Fresh", 1000, 0, 0),
      person("scored", "Scored", 1000, 1, 0)]).map((row) => row.uid))
      .toEqual(["scored"]);
  });

  test("legacy accounts missing ELO use the 1000 starting rating", () => {
    const legacy = { uid: "legacy", username: "Legacy",
      ranking: {points: 90, rankedSessions: 1, averageScore: 90} };
    expect(rankProfiles([legacy])[0]).toEqual({
      uid: "legacy", username: "Legacy", elo: 1000, rank: 1,
    });
  });

  test("malformed ELO and missing ranking records are omitted", () => {
    const rows = [
      {uid: "none", username: "None"},
      person("bad", "Bad", -1),
      person("string", "String", "1100"),
      person("invalid", "Invalid", NaN),
      person("badCount", "BadCount", 1400, -1),
      person("valid", "Valid", 1234),
    ];
    expect(rankProfiles(rows).map((row) => row.uid)).toEqual(["valid"]);
  });

  test("excludes deleted users and blank names", () => {
    expect(rankProfiles([
      {...person("delete", "Deleted", 1300), deleting: true},
      {...person("status", "Gone", 1400), status: "deleting"},
      person("empty", " ", 1300),
    ])).toEqual([]);
  });

  test("returns only public ELO fields, never points or private data", () => {
    const [entry] = rankProfiles([{
      ...person("u", "User", 1100), email: "secret", role: "admin",
    }]);
    expect(entry).toEqual({uid: "u", username: "User", elo: 1100, rank: 1});
  });

  test("accepts a real zero ELO", () => {
    expect(rankProfiles([person("u", "Zero", 0)])[0].elo).toBe(0);
  });

  test("expects profile arrays and limits global results to fifty", () => {
    expect(() => rankProfiles(null)).toThrow("Ranking profiles must be an array.");
    expect(GLOBAL_LEADERBOARD_LIMIT).toBe(50);
  });
});
