"use strict";

// Controlled manual recovery for uncertain AI evaluations.
// Run only after investigating the provider outcome.
//
// This script cannot guarantee that a second provider
// request will not incur another charge.

const {
  admin,
  db,
} = require("../src/firebaseAdmin");

const FirestoreEvaluationRepository = require(
  "../src/repositories/firestore/FirestoreEvaluationRepository"
);

function parseArgs(args) {
  const options = {};

  for (const item of args) {
    if (item === "--confirm-risk") {
      options.confirmRisk = true;
      continue;
    }

    const match = item.match(
      /^--(session|question|operator|evidence)=(.+)$/
    );

    if (!match) {
      throw new Error(
        `Unrecognized argument: ${item}`
      );
    }

    options[match[1]] = match[2];
  }

  if (
    !options.confirmRisk ||
    !options.session ||
    !options.question ||
    !options.operator ||
    !options.evidence
  ) {
    throw new Error(
      "Requires --session, --question, --operator, --evidence and --confirm-risk."
    );
  }

  return options;
}

async function main() {
  const args = parseArgs(
    process.argv.slice(2)
  );

  const repository =
    new FirestoreEvaluationRepository({
      db,
      admin,
    });

  const result =
    await repository.reconcileUncertainEvaluation({
      sessionId: args.session,
      questionId: args.question,
      operatorId: args.operator,
      evidenceReference: args.evidence,
    });

  if (!result) {
    throw new Error(
      "Evaluation was not reconciled."
    );
  }

  console.log(
    "Review recorded. The next valid request may retry, subject to the daily and per-question limits."
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(
      `Reconciliation failed: ${
        error.code || error.message
      }`
    );

    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
};