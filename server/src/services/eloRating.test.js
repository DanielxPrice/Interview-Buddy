
"use strict";

const { ELO_CONFIG, calculateEloUpdate } = require("./eloRating");

describe("SCRUM-111 ELO calculation - normal behavior", () => {
  test("uses an initial ELO of 1000 for a new user", () => {
    expect(calculateEloUpdate({ sessionScore: 100 })).toEqual({
      previousElo: 1000,
      newElo: 1016,
      eloChange: 16,
    });
  });

  test("treats a null saved rating as a new account", () => {
    expect(calculateEloUpdate({ currentElo: null, sessionScore: 75 })).toEqual({
      previousElo: 1000,
      newElo: 1008,
      eloChange: 8,
    });
  });

  test.each([
    [0, 984, -16],
    [25, 992, -8],
    [50, 1000, 0],
    [75, 1008, 8],
    [100, 1016, 16],
  ])(
    "at ELO 1000 a session score of %i produces ELO %i",
    (sessionScore, newElo, eloChange) => {
      expect(calculateEloUpdate({ currentElo: 1000, sessionScore })).toEqual({
        previousElo: 1000,
        newElo,
        eloChange,
      });
    }
  );

  test("higher-rated users gain less for the same performance", () => {
    const averageUser = calculateEloUpdate({
      currentElo: 1000,
      sessionScore: 100,
    });
    const higherRatedUser = calculateEloUpdate({
      currentElo: 1200,
      sessionScore: 100,
    });

    expect(averageUser.eloChange).toBe(16);
    expect(higherRatedUser.eloChange).toBe(8);
  });

  test("higher-rated users can lose rating for average performance", () => {
    expect(calculateEloUpdate({ currentElo: 1200, sessionScore: 50 })).toEqual({
      previousElo: 1200,
      newElo: 1192,
      eloChange: -8,
    });
  });

  test("repeated calculations use the newly returned rating", () => {
    const first = calculateEloUpdate({
      currentElo: 1000,
      sessionScore: 100,
    });
    const second = calculateEloUpdate({
      currentElo: first.newElo,
      sessionScore: 100,
    });

    expect(first).toEqual({
      previousElo: 1000,
      newElo: 1016,
      eloChange: 16,
    });
    expect(second).toEqual({
      previousElo: 1016,
      newElo: 1031,
      eloChange: 15,
    });
  });

  test("same inputs always produce the same output", () => {
    const input = { currentElo: 1275, sessionScore: 82 };
    const first = calculateEloUpdate(input);
    const second = calculateEloUpdate(input);

    expect(first).toEqual(second);
    expect(input).toEqual({ currentElo: 1275, sessionScore: 82 });
  });
});

describe("SCRUM-111 ELO calculation - boundaries and invalid data", () => {
  test("accepts a saved rating of zero rather than resetting it", () => {
    expect(calculateEloUpdate({ currentElo: 0, sessionScore: 0 })).toEqual({
      previousElo: 0,
      newElo: 0,
      eloChange: 0,
    });
  });

  test("never produces a negative rating", () => {
    const outcome = calculateEloUpdate({
      currentElo: 1,
      sessionScore: 0,
    });

    expect(outcome.newElo).toBeGreaterThanOrEqual(ELO_CONFIG.minimumElo);
  });

  test.each([-1, 101, 50.5, "80", null, undefined, true, NaN, Infinity])(
    "rejects invalid session score: %s",
    (sessionScore) => {
      expect(() =>
        calculateEloUpdate({ currentElo: 1000, sessionScore })
      ).toThrow(/Session score must be an integer from 0 to 100/);
    }
  );

  test.each([-1, 1200.5, "1200", true, NaN, Infinity, {}, []])(
    "rejects invalid saved ELO: %s",
    (currentElo) => {
      try {
        calculateEloUpdate({ currentElo, sessionScore: 75 });
        throw new Error("Expected invalid rating to be rejected.");
      } catch (error) {
        expect(error).toMatchObject({
          code: "INVALID_ELO_INPUT",
          statusCode: 409,
        });
      }
    }
  );

  test.each([null, undefined, 100, []])(
    "rejects invalid call input: %s",
    (input) => {
      expect(() => calculateEloUpdate(input)).toThrow(
        /ELO input must be an object/
      );
    }
  );
});
