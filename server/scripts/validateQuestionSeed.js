const fs = require("fs");
const path = require("path");
const { validateRubric } = require("../src/services/evaluationContract");

const ALLOWED_MODES = ["Quiz Style", "Code Style", "Theoretical Style"];
const ALLOWED_LEVELS = ["Beginner", "Intermediate", "Experienced", "Veteran"];
const ALLOWED_DIFFICULTIES = ["Beginner", "Intermediate", "Experienced"];
const seedPath = path.join(__dirname, "..", "seed", "questions.json");

function fail(message) {
  throw new Error(message);
}

function nonblankString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateStringArray(question, field, allowedValues) {
  const values = question[field];
  if (!Array.isArray(values) || values.length === 0 || !values.every(nonblankString)) {
    fail(`Question ${question.id} requires a non-empty ${field} array of nonblank strings.`);
  }

  if (new Set(values.map((value) => value.trim().toLowerCase())).size !== values.length) {
    fail(`Question ${question.id} has duplicate ${field} values.`);
  }

  if (allowedValues) {
    const invalid = values.find((value) => !allowedValues.includes(value));
    if (invalid) {
      fail(`Question ${question.id} has unsupported ${field} value: ${invalid}.`);
    }
  }
}

function validateQuestion(question) {
  if (!question || !nonblankString(question.id) ||
      !nonblankString(question.mode) || !nonblankString(question.prompt)) {
    fail("Every question requires a nonblank id, mode, and prompt.");
  }

  if (!ALLOWED_MODES.includes(question.mode)) {
    fail(`Question ${question.id} has invalid mode ${question.mode}.`);
  }

  for (const field of ["difficulty", "topic"]) {
    if (!nonblankString(question[field])) {
      fail(`Question ${question.id} requires a nonblank ${field}.`);
    }
  }

  if (!ALLOWED_DIFFICULTIES.includes(question.difficulty)) {
    fail(`Question ${question.id} has an invalid difficulty: ${question.difficulty}.`);
  }
  if (typeof question.active !== "boolean") {
    fail(`Question ${question.id} requires a boolean active flag.`);
  }
  if (typeof question.priority !== "number" || !Number.isFinite(question.priority)) {
    fail(`Question ${question.id} requires a finite numeric priority.`);
  }

  validateStringArray(question, "tags");
  validateStringArray(question, "experienceLevels", ALLOWED_LEVELS);
  validateStringArray(question, "jobRoles");

  if (question.mode === "Quiz Style") {
    if (!Array.isArray(question.options) || question.options.length < 2 ||
        !question.options.every(nonblankString)) {
      fail(`Quiz question ${question.id} requires at least two nonblank options.`);
    }
    if (!nonblankString(question.correctAnswer) || !nonblankString(question.explanation)) {
      fail(`Quiz question ${question.id} requires correctAnswer and explanation.`);
    }
    if (!question.options.includes(question.correctAnswer)) {
      fail(`Quiz question ${question.id} has a correctAnswer outside options.`);
    }
    if (new Set(question.options.map((option) => option.trim().toLowerCase())).size !==
        question.options.length) {
      fail(`Quiz question ${question.id} contains duplicate options.`);
    }
  } else {
    const rubricError = validateRubric(question);
    if (rubricError) {
      fail(`Question ${question.id} has an invalid rubric: ${rubricError}`);
    }
  }
}

/**
 * Pure validator used by both the command-line check and Jest tests.
 * enforceCoverage=false is only for unit-test fixtures smaller than the
 * required production seed (500-1000 questions in each interview mode).
 */
function validateSeedData(questions, { enforceCoverage = true } = {}) {
  if (!Array.isArray(questions) || questions.length === 0) {
    fail("Question seed must be a non-empty array.");
  }

  const seenIds = new Set();
  const modeCounts = new Map(ALLOWED_MODES.map((mode) => [mode, 0]));
  const modeTagCounts = new Map(ALLOWED_MODES.map((mode) => [mode, new Map()]));
  const modeRoleCounts = new Map(ALLOWED_MODES.map((mode) => [mode, new Map()]));
  const modeLevelCounts = new Map(ALLOWED_MODES.map((mode) => [mode, new Map()]));

  for (const question of questions) {
    validateQuestion(question);
    if (seenIds.has(question.id)) {
      fail(`Duplicate question id: ${question.id}`);
    }
    seenIds.add(question.id);
    modeCounts.set(question.mode, modeCounts.get(question.mode) + 1);

    for (const [field, counts] of [
      ["tags", modeTagCounts],
      ["jobRoles", modeRoleCounts],
      ["experienceLevels", modeLevelCounts],
    ]) {
      const values = counts.get(question.mode);
      for (const value of question[field]) {
        values.set(value, (values.get(value) || 0) + 1);
      }
    }
  }

  if (enforceCoverage) {
    for (const mode of ALLOWED_MODES) {
      const count = modeCounts.get(mode);
      if (count < 500 || count > 1000) {
        fail(`${mode} must contain 500-1000 questions. Found ${count}.`);
      }

      const sparseTags = [...modeTagCounts.get(mode)].filter(([, count]) => count < 10);
      if (sparseTags.length > 0) {
        fail(`${mode} contains sparse tags (<10 questions): ${sparseTags
          .map(([tag, count]) => `${tag}=${count}`).join(", ")}`);
      }
    }
  }

  return { total: questions.length, modeCounts, modeTagCounts, modeRoleCounts, modeLevelCounts };
}

function formatSummary(summary) {
  const lines = [`Validated ${summary.total} questions.`];
  for (const mode of ALLOWED_MODES) {
    const tags = summary.modeTagCounts.get(mode);
    const roles = summary.modeRoleCounts.get(mode);
    const levels = summary.modeLevelCounts.get(mode);
    const minTagCount = tags.size ? Math.min(...tags.values()) : 0;
    lines.push(`\n${mode}: ${summary.modeCounts.get(mode)} questions`);
    lines.push(`  tags: ${tags.size} unique, minimum coverage ${minTagCount}`);
    lines.push(`  roles: ${roles.size} unique`);
    lines.push(`  experience: ${[...levels.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([level, count]) => `${level}=${count}`)
      .join(", ")}`);
  }
  return lines.join("\n");
}

if (require.main === module) {
  const questions = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  console.log(formatSummary(validateSeedData(questions)));
}

module.exports = { validateQuestion, validateSeedData, formatSummary };
