require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { questionRepository } = require("../src/repositories");
const { validateRubric } = require("../src/services/evaluationContract");

const ALLOWED_MODES = new Set([
  "Quiz Style",
  "Code Style",
  "Theoretical Style",
]);

function validateQuestion(question) {
  if (!question.id || !question.mode || !question.prompt) {
    throw new Error(
      "Every seed question must include id, mode, and prompt fields."
    );
  }

  if (!ALLOWED_MODES.has(question.mode)) {
    throw new Error(
      `Question ${question.id} has an invalid mode: ${question.mode}.`
    );
  }

  if (!Array.isArray(question.tags) || question.tags.length === 0) {
    throw new Error(`Question ${question.id} requires at least one tag.`);
  }

  if (
    !Array.isArray(question.experienceLevels) ||
    question.experienceLevels.length === 0
  ) {
    throw new Error(
      `Question ${question.id} requires at least one experience level.`
    );
  }

  if (!Array.isArray(question.jobRoles) || question.jobRoles.length === 0) {
    throw new Error(`Question ${question.id} requires at least one job role.`);
  }

  if (question.mode === "Quiz Style") {
    if (!Array.isArray(question.options) || question.options.length < 2) {
      throw new Error(
        `Quiz question ${question.id} requires at least two options.`
      );
    }

    if (!question.correctAnswer || !question.explanation) {
      throw new Error(
        `Quiz question ${question.id} requires correctAnswer and explanation.`
      );
    }

    if (!question.options.includes(question.correctAnswer)) {
      throw new Error(
        `Quiz question ${question.id} has a correctAnswer that is not present in options.`
      );
    }

    return;
  }

  const rubricError = validateRubric(question);
  if (rubricError) {
    throw new Error(
      `AI-graded question ${question.id} is invalid: ${rubricError}`
    );
  }
}

async function seed() {
  const seedPath = path.join(__dirname, "..", "seed", "questions.json");
  const questions = JSON.parse(fs.readFileSync(seedPath, "utf8"));

  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error("server/seed/questions.json does not contain any questions.");
  }

  const seenIds = new Set();

  for (const question of questions) {
    validateQuestion(question);

    if (seenIds.has(question.id)) {
      throw new Error(`Duplicate question id in seed file: ${question.id}.`);
    }

    seenIds.add(question.id);
  }

  const count = await questionRepository.upsertMany(questions);
  console.log(`Seeded ${count} validated questions through QuestionRepository.`);
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
