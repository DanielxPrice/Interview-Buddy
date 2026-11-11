const AI_GRADABLE_MODES = new Set(["Code Style", "Theoretical Style"]);


// Grading consistency: each criterion may only score one of these fractions
// of its weight. The model's raw points are snapped to the nearest band so
// similar answers land on the same score. See GRADING_CONSISTENCY.md.
const SCORE_BANDS = Object.freeze([
  0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1,
]);

// Treat values this close as equal, so float noise (e.g. 0.35 stored as
// 0.34999999) cannot change which band wins a tie.
const BAND_EPSILON = 1e-9;

/**
 * Snap a criterion's awarded points to the nearest score band.
 * Exact ties between two bands go to the higher band.
 * Assumes 0 <= awardedPoints <= maxPoints (validated by the caller).
 */
function snapToBand(awardedPoints, maxPoints) {
  const fraction = awardedPoints / maxPoints;
  let closest = SCORE_BANDS[0];

  for (const band of SCORE_BANDS) {
    const distance = Math.abs(fraction - band);
    const closestDistance = Math.abs(fraction - closest);

    if (
      distance < closestDistance - BAND_EPSILON ||
      (Math.abs(distance - closestDistance) <= BAND_EPSILON && band > closest)
    ) {
      closest = band;
    }
  }

  return Math.round(closest * maxPoints * 10) / 10;
}

function validateRubric(question) {
  if (!question || !question.prompt || !String(question.prompt).trim()) {
    return "AI-graded questions require a prompt.";
  }

  if (!question.referenceAnswer || !String(question.referenceAnswer).trim()) {
    return "AI-graded questions require a private referenceAnswer.";
  }

  if (
    !Array.isArray(question.gradingCriteria) ||
    question.gradingCriteria.length < 2
  ) {
    return "AI-graded questions require at least two gradingCriteria entries.";
  }

  let totalWeight = 0;

  for (const criterion of question.gradingCriteria) {
    if (
      !criterion ||
      !String(criterion.name || "").trim() ||
      !String(criterion.description || "").trim()
    ) {
      return "Every grading criterion requires a name and description.";
    }

    const weight = Number(criterion.weight);
    if (!Number.isFinite(weight) || weight <= 0) {
      return "Every grading criterion requires a positive numeric weight.";
    }

    totalWeight += weight;
  }

  if (Math.abs(totalWeight - 100) > 0.001) {
    return `AI grading criterion weights must total 100. Current total: ${totalWeight}.`;
  }

  return null;
}

function formatRubric(criteria) {
  return criteria
    .map(
      (criterion, index) =>
        `${index + 1}. ${criterion.name} (${criterion.weight} points): ${criterion.description}`
    )
    .join("\n");
}

function normalizeTextArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 6);
}

function normalizeEvaluation(rawEvaluation, gradingCriteria) {
  if (!rawEvaluation || !Array.isArray(rawEvaluation.criterionResults)) {
    throw new Error("AI response is missing criterionResults.");
  }

  if (rawEvaluation.criterionResults.length !== gradingCriteria.length) {
    throw new Error(
      "AI response did not return one result for each grading criterion."
    );
  }

  const criterionResults = gradingCriteria.map((criterion, index) => {
    const result = rawEvaluation.criterionResults[index] || {};

    //Verify the AI returned the correct grading criterion
    //Results must match the rubric order and names
    //Previously we just used array position alone
    const expectedName = String(criterion.name).trim();
    const returnedName = String(result.name || "").trim();

    if (returnedName !== expectedName) {
      throw new Error(
        `AI evaluation criterion name mismatch at index ${index}: ` +
        `expected "${expectedName}", received "${returnedName}".`
      );
    }

    // CC6.6: accept only real JSON numbers. Number() coercion previously let
    // null, "", " ", true, [60] and "0x3C" through as valid point values, so a
    // malformed response could silently award 0, 1 or full points.
    const awardedPoints = result.awardedPoints;
    const maxPoints = Number(criterion.weight);

    if (
      typeof awardedPoints !== "number" ||
      !Number.isFinite(awardedPoints)
    ) {
      throw new Error(
        `AI result for ${criterion.name} is missing awardedPoints.`
      );
    }

    if (awardedPoints < 0 || awardedPoints > maxPoints) {
      throw new Error(
        `AI awardedPoints for ${criterion.name} must be between 0 and ${maxPoints}.`
      );
    }

    const feedback = String(result.feedback || "").trim();
    if (!feedback) {
      throw new Error(
        `AI result for ${criterion.name} is missing feedback.`
      );
    }

    return {
      name: criterion.name,
      awardedPoints: Math.round(awardedPoints * 10) / 10,
      maxPoints,
      feedback,
    };
  });

  const calculatedScore = Math.round(
    criterionResults.reduce((sum, result) => sum + result.awardedPoints, 0)
  );

  const feedback = String(rawEvaluation.feedback || "").trim();
  if (!feedback) {
    throw new Error("AI response is missing overall feedback.");
  }

  return {
    score: Math.max(0, Math.min(100, calculatedScore)),
    feedback,
    strengths: normalizeTextArray(rawEvaluation.strengths),
    weaknesses: normalizeTextArray(rawEvaluation.weaknesses),
    suggestions: normalizeTextArray(rawEvaluation.suggestions),
    criterionResults,
  };
}

// CC6.6 / B-SOC-04: server-side guard against reference-answer leakage.
// The private reference answer has to be sent to the model, so the prompt
// alone cannot guarantee it stays private. Any run of LEAK_MIN_WORDS or more
// consecutive words copied from the reference answer into user-facing feedback
// is replaced with "[redacted]" before the evaluation leaves the server.
const LEAK_MIN_WORDS = 8;
const REDACTED = "[redacted]";

function wordTokens(text) {
  return [...String(text || "").matchAll(/[A-Za-z0-9_]+/g)].map((match) => ({
    word: match[0].toLowerCase(),
    start: match.index,
    end: match.index + match[0].length,
  }));
}

function redactLeaksInText(text, shingles, size) {
  const tokens = wordTokens(text);
  const covered = new Array(tokens.length).fill(false);

  for (let i = 0; i + size <= tokens.length; i++) {
    const window = tokens.slice(i, i + size).map((t) => t.word).join(" ");
    if (shingles.has(window)) {
      covered.fill(true, i, i + size);
    }
  }

  if (!covered.includes(true)) {
    return { text, changed: false };
  }

  let output = "";
  let cursor = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (!covered[i]) continue;
    let j = i;
    while (j + 1 < tokens.length && covered[j + 1]) j++;
    output += text.slice(cursor, tokens[i].start) + REDACTED;
    cursor = tokens[j].end;
    i = j;
  }
  output += text.slice(cursor);

  return { text: output, changed: true };
}

function redactReferenceLeaks(evaluation, referenceAnswer) {
  const referenceWords = wordTokens(referenceAnswer).map((t) => t.word);
  if (!evaluation || referenceWords.length === 0) {
    return { evaluation, redactedFields: 0 };
  }

  // Short reference answers are matched as a whole.
  const size = Math.min(LEAK_MIN_WORDS, referenceWords.length);
  const shingles = new Set();
  for (let i = 0; i + size <= referenceWords.length; i++) {
    shingles.add(referenceWords.slice(i, i + size).join(" "));
  }

  let redactedFields = 0;
  const clean = (value) => {
    if (typeof value !== "string") return value;
    const result = redactLeaksInText(value, shingles, size);
    if (result.changed) redactedFields++;
    return result.text;
  };
  const cleanList = (list) => (Array.isArray(list) ? list.map(clean) : list);

  const redacted = {
    ...evaluation,
    feedback: clean(evaluation.feedback),
    strengths: cleanList(evaluation.strengths),
    weaknesses: cleanList(evaluation.weaknesses),
    suggestions: cleanList(evaluation.suggestions),
    criterionResults: Array.isArray(evaluation.criterionResults)
      ? evaluation.criterionResults.map((result) => ({
          ...result,
          feedback: clean(result.feedback),
        }))
      : evaluation.criterionResults,
  };

  return redactedFields > 0
    ? { evaluation: redacted, redactedFields }
    : { evaluation, redactedFields: 0 };
}

module.exports = {
  LEAK_MIN_WORDS,
  redactReferenceLeaks,
  AI_GRADABLE_MODES,
  validateRubric,
  formatRubric,
  normalizeEvaluation,
};