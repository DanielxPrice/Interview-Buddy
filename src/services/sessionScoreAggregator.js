// server/src/services/sessionScoreAggregator.js
//
// Turns the per-question (and per-step) scores saved for a session into one
// session score. This is the only place the session score is calculated, so
// every screen and the stored result agree. The rules are documented in
// SESSION_SCORING.md at the repo root; keep the two in sync.
//
// Rules, in short:
//   1. Every question score is on a 0-100 scale.
//   2. A question's score is `evaluation.score` when it is present.
//   3. If `evaluation.score` is missing, it is derived from the per-step
//      (rubric criterion) results: sum(awardedPoints) / sum(maxPoints) * 100.
//   4. Each question counts once by default (weight 1). A response may carry a
//      positive `weight` to count more or less.
//   5. The session score is the weighted mean of question scores, rounded to
//      the nearest whole number (halves round up), clamped to 0-100.
//   6. A session with no answered questions scores 0.
//   7. Any invalid score, step or weight rejects the whole aggregation. We never
//      silently skip or clamp bad data, because that would hide a grading bug
//      behind a plausible-looking number.

const MIN_SCORE = 0;
const MAX_SCORE = 100;
const DEFAULT_WEIGHT = 1;

class InvalidScoringDataError extends Error {
  constructor(message, index = null) {
    super(message);
    this.name = "InvalidScoringDataError";
    this.index = index;
  }
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// Removes floating point noise (e.g. 84.49999999 -> 84.5) before rounding,
// so a true .5 always rounds up.
function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(Number((value * factor).toFixed(6))) / factor;
}

// Rule 3: derive a 0-100 question score from per-step (criterion) results.
function scoreFromSteps(steps, index = null) {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new InvalidScoringDataError(
      "Response has no score and no step results to derive one from.",
      index
    );
  }

  let awarded = 0;
  let possible = 0;

  for (const step of steps) {
    const awardedPoints = step?.awardedPoints;
    const maxPoints = step?.maxPoints;

    if (!isFiniteNumber(maxPoints) || maxPoints <= 0) {
      throw new InvalidScoringDataError(
        "Every step result needs a positive maxPoints.",
        index
      );
    }

    if (
      !isFiniteNumber(awardedPoints) ||
      awardedPoints < 0 ||
      awardedPoints > maxPoints
    ) {
      throw new InvalidScoringDataError(
        "Every step result needs awardedPoints between 0 and maxPoints.",
        index
      );
    }

    awarded += awardedPoints;
    possible += maxPoints;
  }

  return roundTo((awarded / possible) * MAX_SCORE, 1);
}

// Rules 1-3: the 0-100 score for one saved response.
function resolveQuestionScore(response, index = null) {
  const evaluation = response?.evaluation;

  if (!evaluation || typeof evaluation !== "object") {
    throw new InvalidScoringDataError("Response has no evaluation.", index);
  }

  const { score } = evaluation;

  if (score !== undefined && score !== null) {
    if (!isFiniteNumber(score) || score < MIN_SCORE || score > MAX_SCORE) {
      throw new InvalidScoringDataError(
        `Question score must be a number from ${MIN_SCORE} to ${MAX_SCORE}.`,
        index
      );
    }

    return score;
  }

  return scoreFromSteps(evaluation.criterionResults, index);
}

// Rule 4.
function resolveWeight(response, index = null) {
  const weight = response?.weight;

  if (weight === undefined || weight === null) {
    return DEFAULT_WEIGHT;
  }

  if (!isFiniteNumber(weight) || weight <= 0) {
    throw new InvalidScoringDataError(
      "Question weight must be a positive number.",
      index
    );
  }

  return weight;
}

/**
 * Aggregate saved responses into a session result.
 *
 * @param {Array<object>} responses saved response documents
 * @returns {{score: number, questionsAnswered: number, totalScore: number}}
 *   score             - session score, whole number 0-100 (rules 5-6)
 *   questionsAnswered - number of responses counted
 *   totalScore        - unweighted sum of question scores (kept for
 *                       compatibility with results already stored)
 * @throws {InvalidScoringDataError} when any response is invalid (rule 7)
 */
function aggregateSessionScore(responses) {
  if (!Array.isArray(responses)) {
    throw new InvalidScoringDataError("Responses must be an array.");
  }

  if (responses.length === 0) {
    return { score: 0, questionsAnswered: 0, totalScore: 0 };
  }

  let weightedSum = 0;
  let totalWeight = 0;
  let totalScore = 0;

  responses.forEach((response, index) => {
    const questionScore = resolveQuestionScore(response, index);
    const weight = resolveWeight(response, index);

    weightedSum += questionScore * weight;
    totalWeight += weight;
    totalScore += questionScore;
  });

  const mean = weightedSum / totalWeight;
  const score = Math.min(
    MAX_SCORE,
    Math.max(MIN_SCORE, Math.round(roundTo(mean, 6)))
  );

  return {
    score,
    questionsAnswered: responses.length,
    totalScore: roundTo(totalScore, 1),
  };
}

module.exports = {
  aggregateSessionScore,
  resolveQuestionScore,
  scoreFromSteps,
  InvalidScoringDataError,
  DEFAULT_WEIGHT,
};


