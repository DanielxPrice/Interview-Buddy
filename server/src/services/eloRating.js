
"use strict";

// SCRUM-111: Application-layer ELO calculation only.
// SCRUM-112 will call this from the session-completion workflow.
// SCRUM-117 owns storing and retrieving ELO in Firestore.
// Parameters are proposed until the team approves the final rating policy.
const ELO_CONFIG = Object.freeze({
  initialElo: 1000,
  benchmarkElo: 1000,
  kFactor: 32,
  ratingScale: 400,
  minimumElo: 0,
});

function invalidEloInput(message) {
  const error = new TypeError(message);
  error.code = "INVALID_ELO_INPUT";
  error.statusCode = 409;
  return error;
}

function resolveCurrentElo(currentElo) {
  // Older accounts may not have an ELO field yet. Zero is a valid rating.
  if (currentElo === null || currentElo === undefined) {
    return ELO_CONFIG.initialElo;
  }

  if (!Number.isSafeInteger(currentElo) || currentElo < ELO_CONFIG.minimumElo) {
    throw invalidEloInput("Current ELO must be a nonnegative safe integer.");
  }

  return currentElo;
}

/**
 * Calculate the proposed performance-based ELO change for a completed session.
 *
 * expected = 1 / (1 + 10 ^ ((benchmarkElo - previousElo) / ratingScale))
 * actual   = sessionScore / 100
 * newElo   = round(max(minimumElo, previousElo + kFactor * (actual - expected)))
 *
 * This function does not read/write Firestore or decide session eligibility.
 * Call only after the server has calculated an authoritative 0-100 session score.
 *
 * @param {{ currentElo?: number | null, sessionScore: number }} input
 * @returns {{ previousElo: number, newElo: number, eloChange: number }}
 */
function calculateEloUpdate(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw invalidEloInput("ELO input must be an object.");
  }

  const { currentElo, sessionScore } = input;
  if (
    !Number.isSafeInteger(sessionScore) ||
    sessionScore < 0 ||
    sessionScore > 100
  ) {
    throw invalidEloInput("Session score must be an integer from 0 to 100.");
  }

  const previousElo = resolveCurrentElo(currentElo);
  const expectedPerformance =
    1 /
    (1 +
      Math.pow(
        10,
        (ELO_CONFIG.benchmarkElo - previousElo) / ELO_CONFIG.ratingScale
      ));
  const actualPerformance = sessionScore / 100;

  const newElo = Math.round(
    Math.max(
      ELO_CONFIG.minimumElo,
      previousElo +
        ELO_CONFIG.kFactor * (actualPerformance - expectedPerformance)
    )
  );

  if (!Number.isSafeInteger(newElo)) {
    throw invalidEloInput("Calculated ELO is outside the supported range.");
  }

  return {
    previousElo,
    newElo,
    eloChange: newElo - previousElo,
  };
}

module.exports = { ELO_CONFIG, calculateEloUpdate };
