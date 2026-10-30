
"use strict";

const { initialRanking, nextRanking } = require("./rankingScore");

describe("SCRUM-84 initial ranking calculation", () => {
  test("new users start with zero points and zero ranked sessions", () => {
    expect(initialRanking()).toEqual({
      points: 0,
      rankedSessions: 0,
      averageScore: 0,
    });
  });

  test("first ranked session stores its score and count", () => {
    expect(nextRanking(null, 85)).toEqual({
      points: 85,
      rankedSessions: 1,
      averageScore: 85,
    });
  });

  test("subsequent ranked sessions accumulate points and calculate an average", () => {
    expect(
      nextRanking(
        { points: 85, rankedSessions: 1, averageScore: 85 },
        70
      )
    ).toEqual({
      points: 155,
      rankedSessions: 2,
      averageScore: 77.5,
    });
  });

  test.each([0, 100])("accepts a valid score boundary: %s", (score) => {
    expect(nextRanking(null, score).points).toBe(score);
  });

  test.each([-1, 101, 2.2, NaN, Infinity, "70", null])(
    "rejects invalid session score: %s",
    (score) => {
      expect(() => nextRanking(null, score)).toThrow(
        /integer from 0 to 100/
      );
    }
  );

  test.each([
    { points: -1, rankedSessions: 1 },
    { points: 101, rankedSessions: 1 },
    { points: 10, rankedSessions: 0 },
    { points: 20, rankedSessions: -1 },
    { points: "20", rankedSessions: 1 },
    { points: Infinity, rankedSessions: 1 },
    [],
  ])("rejects malformed saved ranking data", (ranking) => {
    try {
      nextRanking(ranking, 90);
      throw new Error("unexpected success");
    } catch (error) {
      expect(error).toMatchObject({
        code: "RANKING_DATA_INVALID",
        statusCode: 503,
      });
    }
  });
});
