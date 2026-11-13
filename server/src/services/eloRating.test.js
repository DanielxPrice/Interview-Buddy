"use strict";

const { ELO_CONFIG, calculateEloUpdate } = require("./eloRating");
const calc = (score, experienceLevel = "Intermediate", questionCount = 10, currentElo = 1000) =>
  calculateEloUpdate({ currentElo, sessionScore: score, experienceLevel, questionCount });

describe("difficulty and length weighted ELO calculation", () => {
  test.each([
    ["Beginner", 1, 100, 0],
    ["Beginner", 4, 100, 0],
    ["Beginner", 5, 100, 5],
    ["Beginner", 10, 100, 9],
    ["Beginner", 10, 50, -7],
    ["Intermediate", 10, 50, 0],
    ["Experienced", 10, 50, 7],
    ["Veteran", 5, 40, 4],
    ["Veteran", 10, 50, 11],
    ["Veteran", 20, 75, 38],
  ])("%s difficulty, %s questions, %s%% score changes ELO by %s",
    (experienceLevel, questionCount, score, change) => {
      expect(calc(score, experienceLevel, questionCount)).toEqual({
        previousElo: 1000, newElo: 1000 + change, eloChange: change,
      });
    });

  test("a low score on Veteran can still earn ELO", () => {
    expect(calc(20, "Veteran", 10).eloChange).toBeGreaterThan(0);
  });

  test("length weighting is capped at 20 and short interviews are unchanged", () => {
    expect(ELO_CONFIG.maximumLengthWeightQuestions).toBe(20);
    expect(calc(100, "Beginner", 1)).toEqual({previousElo: 1000, newElo: 1000, eloChange: 0});
  });

  test("normalizes stored experience level casing", () => {
    expect(calc(100, " beginner ", 5)).toEqual(calc(100, "Beginner", 5));
  });

  test("legacy missing ELO starts at 1000 and saved zero stays valid", () => {
    expect(calculateEloUpdate({ sessionScore: 100, questionCount: 10,
      experienceLevel: "Intermediate" }).newElo).toBe(1016);
    expect(calc(0, "Intermediate", 10, 0).newElo).toBe(0);
  });

  test("a higher rating gains less and can lose for the same performance", () => {
    expect(calc(100, "Intermediate", 10, 1200).eloChange).toBe(8);
    expect(calc(50, "Intermediate", 10, 1200).eloChange).toBe(-8);
  });

  test("consecutive results use the updated persisted ELO", () => {
    const first = calc(100);
    const second = calc(100, "Intermediate", 10, first.newElo);
    expect(first.eloChange).toBe(16);
    expect(second).toEqual({previousElo: 1016, newElo: 1031, eloChange: 15});
  });

  test("does not mutate input and is deterministic", () => {
    const input = { currentElo: 1275, sessionScore: 82,
      experienceLevel: "Experienced", questionCount: 12 };
    expect(calculateEloUpdate(input)).toEqual(calculateEloUpdate(input));
    expect(input).toEqual({ currentElo: 1275, sessionScore: 82,
      experienceLevel: "Experienced", questionCount: 12 });
  });
});

describe("ELO invalid values", () => {
  test.each([-1, 101, 50.5, "80", null, undefined, true, NaN, Infinity])(
    "invalid session score: %s", (sessionScore) => {
      expect(() => calculateEloUpdate({currentElo: 1000, sessionScore,
        experienceLevel: "Intermediate", questionCount: 10})).toThrow(/Session score/);
    });
  test.each([-1, 1200.5, "1200", true, NaN, Infinity, {}, []])(
    "invalid ELO: %s", (currentElo) => {
      expect(() => calc(75, "Intermediate", 10, currentElo))
        .toThrow(/Current ELO/);
    });
  test.each([0, -1, 21, 1.5, "5", null, undefined])(
    "invalid question count: %s", (questionCount) => {
      expect(() => calculateEloUpdate({currentElo: 1000, sessionScore: 50,
        experienceLevel: "Beginner", questionCount})).toThrow(/Question count/);
    });
  test.each(["Master", "", 1000, null, undefined])(
    "invalid experience level: %s", (experienceLevel) => {
      expect(() => calculateEloUpdate({currentElo: 1000, sessionScore: 50,
        experienceLevel, questionCount: 10})).toThrow(/Experience level/);
    });
  test.each([null, undefined, 100, []])("invalid input: %s", (input) => {
    expect(() => calculateEloUpdate(input)).toThrow(/ELO input/);
  });
  test("errors identify the invalid input contract", () => {
    try { calc(50, "Expert"); throw new Error("not rejected"); }
    catch (error) { expect(error).toMatchObject({code: "INVALID_ELO_INPUT", statusCode: 409}); }
  });
});
