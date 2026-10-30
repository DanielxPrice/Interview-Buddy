
"use strict";

// SCRUM-84: Initial score-based ranking, not the final Sprint 5 ELO formula.
// Points increase by the completed session's authoritative 0-100 score.
const INITIAL_RANKING = Object.freeze({
  points: 0,
  rankedSessions: 0,
  averageScore: 0,
});

function initialRanking() {
  return { ...INITIAL_RANKING };
}

function rankingStateError() {
  const error = new Error("Stored ranking data is invalid.");
  error.statusCode = 503;
  error.code = "RANKING_DATA_INVALID";
  return error;
}

function nextRanking(ranking, score) {
  if (!Number.isSafeInteger(score) || score < 0 || score > 100) {
    const error = new Error(
      "Session ranking score must be an integer from 0 to 100."
    );
    error.statusCode = 409;
    error.code = "INVALID_SCORING_DATA";
    throw error;
  }

  const current = ranking == null ? initialRanking() : ranking;

  if (
    !current ||
    typeof current !== "object" ||
    Array.isArray(current) ||
    !Number.isSafeInteger(current.points) ||
    current.points < 0 ||
    !Number.isSafeInteger(current.rankedSessions) ||
    current.rankedSessions < 0 ||
    (current.rankedSessions === 0 && current.points !== 0) ||
    (current.rankedSessions > 0 &&
      current.points > current.rankedSessions * 100) ||
    !Number.isSafeInteger(current.points + score) ||
    !Number.isSafeInteger(current.rankedSessions + 1)
  ) {
    throw rankingStateError();
  }

  const points = current.points + score;
  const rankedSessions = current.rankedSessions + 1;

  return {
    points,
    rankedSessions,
    averageScore: Math.round((points / rankedSessions) * 100) / 100,
  };
}

module.exports = { initialRanking, nextRanking };
