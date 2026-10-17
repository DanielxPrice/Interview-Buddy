const AI_GRADABLE_MODES = new Set(["Code Style", "Theoretical Style"]);

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
    const awardedPoints = Number(result.awardedPoints);
    const maxPoints = Number(criterion.weight);

    if (!Number.isFinite(awardedPoints)) {
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

module.exports = {
  AI_GRADABLE_MODES,
  validateRubric,
  formatRubric,
  normalizeEvaluation,
};
