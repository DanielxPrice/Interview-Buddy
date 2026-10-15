/**
 * H-01: audit whether each active seed question is reachable by the current
 * deterministic question-selection algorithm. This checks the local seed file,
 * not deployed Firestore. No database writes or API calls are made.
 *
 * Tries every nonempty subset of each question's own tags against all of its
 * roles and experience levels, plus all one-tag setups across each mode.
 * It does not change the selection algorithm or promise that every question
 * must appear within the first N ranked results.
 */
const fs = require("fs");
const path = require("path");
const { selectQuestions } = require("../src/services/questionSelection");

function tagSubsets(tags) {
  const subsets = [];
  for (let mask = 1; mask < 2 ** tags.length; mask += 1) {
    subsets.push(tags.filter((_, index) => mask & (2 ** index)));
  }
  return subsets;
}

function auditQuestions(questions, limit = 10) {
  const byMode = new Map(
    [...new Set(questions.map((question) => question.mode))]
      .map((mode) => [mode, questions.filter((question) => question.mode === mode)])
  );
  const found = new Set();
  let selectionsChecked = 0;

  const check = (modeQuestions, setup) => {
    selectionsChecked += 1;
    for (const question of selectQuestions(modeQuestions, setup, limit)) {
      found.add(question.id);
    }
  };

  for (const modeQuestions of byMode.values()) {
    const active = modeQuestions.filter((question) => question.active !== false);
    const roles = [...new Set(active.flatMap((q) => q.jobRoles))];
    const levels = [...new Set(active.flatMap((q) => q.experienceLevels))];
    const tags = [...new Set(active.flatMap((q) => q.tags))];

    for (const jobRole of roles) {
      for (const experienceLevel of levels) {
        for (const tag of tags) {
          check(modeQuestions, { jobRole, experienceLevel, tags: [tag] });
        }
      }
    }

    for (const question of active) {
      if (found.has(question.id)) continue;
      for (const jobRole of question.jobRoles) {
        for (const experienceLevel of question.experienceLevels) {
          for (const selectedTags of tagSubsets(question.tags)) {
            check(modeQuestions, { jobRole, experienceLevel, tags: selectedTags });
            if (found.has(question.id)) break;
          }
          if (found.has(question.id)) break;
        }
        if (found.has(question.id)) break;
      }
    }
  }

  const notSelected = questions.filter((q) => q.active !== false && !found.has(q.id));
  return {
    limit,
    activeQuestions: questions.filter((q) => q.active !== false).length,
    selectionsChecked,
    neverSelectedInCheckedSetups: notSelected.length,
    byMode: Object.fromEntries([...byMode.keys()].map((mode) => [
      mode, notSelected.filter((question) => question.mode === mode).length,
    ])),
    questions: notSelected.map(({ id, mode, priority, tags, jobRoles, experienceLevels }) => ({
      id, mode, priority, tags, jobRoles, experienceLevels,
    })),
  };
}

if (require.main === module) {
  const questions = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "seed", "questions.json"), "utf8"));
  const requestedLimit = Number(process.argv[2] || 10);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 20) {
    throw new Error("The question-selection limit must be an integer between 1 and 20.");
  }
  console.log(JSON.stringify(auditQuestions(questions, requestedLimit), null, 2));
}

module.exports = { auditQuestions };
