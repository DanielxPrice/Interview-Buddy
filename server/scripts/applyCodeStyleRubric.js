// server/scripts/applyCodeStyleRubric.js
//
// Copies CODE_STYLE_RUBRIC into every Code Style question in
// server/seed/questions.json. Other modes are left untouched.
//
// Usage (from /server):
//   npm run apply-code-style-rubric
//
// This only changes the seed file. Run `npm run seed` afterwards to update
// the questions stored in Firestore.

const fs = require("fs");
const path = require("path");
const { CODE_STYLE_RUBRIC } = require("../src/services/codeStyleRubric");
const { validateRubric } = require("../src/services/evaluationContract");

const seedPath = path.join(__dirname, "..", "seed", "questions.json");

// Returns a new question list with the rubric applied, plus how many changed.
function applyCodeStyleRubric(questions) {
  let updated = 0;

  const result = questions.map((question) => {
    if (question.mode !== "Code Style") {
      return question;
    }

    const next = {
      ...question,
      // Plain copies so the saved JSON does not depend on frozen objects.
      gradingCriteria: CODE_STYLE_RUBRIC.map((criterion) => ({ ...criterion })),
    };

    // Same check the server runs before grading: weights total 100, etc.
    const rubricError = validateRubric(next);
    if (rubricError) {
      throw new Error(`Question ${question.id}: ${rubricError}`);
    }

    if (
      JSON.stringify(question.gradingCriteria) !==
      JSON.stringify(next.gradingCriteria)
    ) {
      updated += 1;
    }

    return next;
  });

  return { questions: result, updated };
}

function main() {
  const questions = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  const { questions: next, updated } = applyCodeStyleRubric(questions);

  // Same formatting as the existing file (2-space indent, trailing newline).
  fs.writeFileSync(seedPath, `${JSON.stringify(next, null, 2)}\n`);

  const codeStyleCount = next.filter((q) => q.mode === "Code Style").length;
  console.log(
    `Applied the Code Style rubric to ${codeStyleCount} questions (${updated} changed).`
  );
}

if (require.main === module) {
  main();
}

module.exports = { applyCodeStyleRubric };