"use strict";

// Performance-based ELO: each interview uses one trusted session difficulty.
const ELO_CONFIG = Object.freeze({
  initialElo: 1000,
  kFactor: 32,
  ratingScale: 400,
  minimumElo: 0,
  minimumRankedQuestions: 5,
  maximumLengthWeightQuestions: 20,
  lengthBaselineQuestions: 10,
  difficultyBenchmarks: Object.freeze({
    beginner: 850,
    intermediate: 1000,
    experienced: 1150,
    veteran: 1300,
  }),
});

function invalidEloInput(message) {
  const error = new TypeError(message);
  error.code = "INVALID_ELO_INPUT";
  error.statusCode = 409;
  return error;
}

function resolveCurrentElo(currentElo) {
  // Legacy profiles without a saved rating start at 1000. Zero remains valid.
  if (currentElo === null || currentElo === undefined) return ELO_CONFIG.initialElo;
  if (!Number.isSafeInteger(currentElo) || currentElo < ELO_CONFIG.minimumElo) {
    throw invalidEloInput("Current ELO must be a nonnegative safe integer.");
  }
  return currentElo;
}

/**
 * Calculates the ELO adjustment for a completed, single-difficulty interview.
 * N < 5: no change. N >= 5:
 * expected = 1 / (1 + 10 ^ ((difficultyBenchmark - previousElo) / 400))
 * K = 32 * min(N, 20) / 10
 * newElo = max(0, round(previousElo + K * (sessionScore / 100 - expected)))
 *
 * Only pass the server-persisted difficulty and assigned question count, never
 * client-supplied completion values. Eligibility and idempotency belong to the
 * session completion transaction, not to this pure function.
 *
 * @param {{ currentElo?: number | null, sessionScore: number, experienceLevel: string, questionCount: number }} input
 * @returns {{ previousElo: number, newElo: number, eloChange: number }}
 */
function calculateEloUpdate(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw invalidEloInput("ELO input must be an object.");
  }
  const { currentElo, sessionScore, experienceLevel, questionCount } = input;
  if (!Number.isSafeInteger(sessionScore) || sessionScore < 0 || sessionScore > 100) {
    throw invalidEloInput("Session score must be an integer from 0 to 100.");
  }
  if (!Number.isSafeInteger(questionCount) || questionCount < 1 || questionCount > 20) {
    throw invalidEloInput("Question count must be an integer from 1 to 20.");
  }
  const difficulty = typeof experienceLevel === "string"
    ? experienceLevel.trim().toLowerCase() : "";
  if (!Object.hasOwn(ELO_CONFIG.difficultyBenchmarks, difficulty)) {
    throw invalidEloInput("Experience level must be Beginner, Intermediate, Experienced, or Veteran.");
  }

  const previousElo = resolveCurrentElo(currentElo);
  if (questionCount < ELO_CONFIG.minimumRankedQuestions) {
    return { previousElo, newElo: previousElo, eloChange: 0 };
  }

  const expected = 1 / (1 + Math.pow(10,
    (ELO_CONFIG.difficultyBenchmarks[difficulty] - previousElo) / ELO_CONFIG.ratingScale));
  const effectiveK = ELO_CONFIG.kFactor *
    Math.min(questionCount, ELO_CONFIG.maximumLengthWeightQuestions) /
    ELO_CONFIG.lengthBaselineQuestions;
  const newElo = Math.max(ELO_CONFIG.minimumElo,
    Math.round(previousElo + effectiveK * (sessionScore / 100 - expected)));
  if (!Number.isSafeInteger(newElo)) {
    throw invalidEloInput("Calculated ELO is outside the supported range.");
  }
  return { previousElo, newElo, eloChange: newElo - previousElo };
}

module.exports = { ELO_CONFIG, calculateEloUpdate };
