
"use strict";

/**
 * SCRUM-84/85: Add missing ranking fields to existing Firestore user profiles.
 *
 * Run from server/:
 *   node scripts/backfillUserRankings.js --dry-run
 *   node scripts/backfillUserRankings.js --apply --project=YOUR_FIREBASE_PROJECT_ID
 *
 * Defaults to a read-only preview.
 * Does not recalculate historical interview scores.
 */

require("dotenv").config();

const { admin, db } = require("../src/firebaseAdmin");
const { initialRanking } = require("../src/services/rankingScore");

const args = process.argv.slice(2);

const apply = args.includes("--apply");
const dryRunFlag = args.includes("--dry-run");

const projectFlag = args.find((arg) =>
  arg.startsWith("--project=")
);

const confirmedProject = projectFlag
  ? projectFlag.slice("--project=".length)
  : "";

if (apply && dryRunFlag) {
  console.error("Choose --apply OR --dry-run, not both.");
  process.exit(1);
}

const projectId =
  admin.app().options.projectId ||
  process.env.FIREBASE_PROJECT_ID;

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

function hasOwn(object, field) {
  return Object.prototype.hasOwnProperty.call(object, field);
}

/**
 * Determine whether a user document needs updating.
 *
 * Existing valid ranking data is preserved.
 * Inconsistent data is skipped for manual investigation.
 */
function planRankingUpdate(user) {
  const ranking = user.ranking;

  // Older profiles may not have a ranking object.
  if (ranking == null) {
    return {
      type: "update",
      fields: ["ranking"],
      changes: {
        ranking: initialRanking(),
      },
    };
  }

  if (
    typeof ranking !== "object" ||
    Array.isArray(ranking)
  ) {
    return {
      type: "invalid",
      reason: "ranking is not a map",
    };
  }

  const hasPoints = hasOwn(ranking, "points");
  const hasSessions = hasOwn(ranking, "rankedSessions");
  const hasAverage = hasOwn(ranking, "averageScore");

  // Validate existing values before modifying anything.
  if (
    (hasPoints &&
      (!Number.isSafeInteger(ranking.points) ||
        ranking.points < 0)) ||
    (hasSessions &&
      (!Number.isSafeInteger(ranking.rankedSessions) ||
        ranking.rankedSessions < 0)) ||
    (hasAverage &&
      (!Number.isFinite(ranking.averageScore) ||
        ranking.averageScore < 0 ||
        ranking.averageScore > 100))
  ) {
    return {
      type: "invalid",
      reason: "existing ranking contains invalid values",
    };
  }

  // We cannot infer historical session counts from points.
  if (hasPoints && !hasSessions) {
    return {
      type: "invalid",
      reason:
        "points exist but rankedSessions is missing; cannot infer historical count",
    };
  }

  if (
    !hasPoints &&
    hasSessions &&
    ranking.rankedSessions > 0
  ) {
    return {
      type: "invalid",
      reason:
        "rankedSessions is positive but points is missing; cannot infer historical points",
    };
  }

  const points = hasPoints ? ranking.points : 0;

  const rankedSessions = hasSessions
    ? ranking.rankedSessions
    : 0;

  // Check consistency with the 0-100 scoring system.
  if (
    (rankedSessions === 0 && points !== 0) ||
    (rankedSessions > 0 &&
      points > rankedSessions * 100)
  ) {
    return {
      type: "invalid",
      reason: "points and rankedSessions are inconsistent",
    };
  }

  const expectedAverage =
    rankedSessions === 0
      ? 0
      : Math.round(
          (points / rankedSessions) * 100
        ) / 100;

  if (
    hasAverage &&
    Math.abs(ranking.averageScore - expectedAverage) >
      0.001
  ) {
    return {
      type: "invalid",
      reason:
        "averageScore conflicts with existing points and rankedSessions",
    };
  }

  // Only initialize missing fields.
  // Dot-path updates preserve other ranking properties.
  const changes = {};

  if (!hasPoints) {
    changes["ranking.points"] = 0;
  }

  if (!hasSessions) {
    changes["ranking.rankedSessions"] = 0;
  }

  if (!hasAverage) {
    changes["ranking.averageScore"] = expectedAverage;
  }

  const fields = Object.keys(changes);

  return fields.length === 0
    ? {
        type: "unchanged",
        fields: [],
        changes: {},
      }
    : {
        type: "update",
        fields,
        changes,
      };
}

/**
 * Execute the migration.
 *
 * Dry run: read documents and report proposed changes.
 * Apply: update documents using Firestore transactions.
 */
async function main() {
  console.log(`Firebase project: ${projectId}`);

  console.log(
    `Firestore target: ${
      emulatorHost
        ? `EMULATOR (${emulatorHost})`
        : "LIVE FIRESTORE"
    }`
  );

  console.log(
    `Mode: ${
      apply ? "APPLY" : "DRY RUN (no writes)"
    }`
  );

  // Require explicit project confirmation before writing.
  if (
    apply &&
    (!confirmedProject ||
      confirmedProject !== projectId)
  ) {
    throw new Error(
      `For writes, supply --project=${projectId} to confirm the target.`
    );
  }

  // Retrieve the ranking field from each existing user profile.
  const snapshot = await db
    .collection("users")
    .select("ranking")
    .get();

  const summary = {
    scanned: snapshot.size,
    unchanged: 0,
    wouldUpdate: 0,
    updated: 0,
    invalid: 0,
    errors: 0,
  };

  for (const userDoc of snapshot.docs) {
    const before = planRankingUpdate(
      userDoc.data() || {}
    );

    if (before.type === "unchanged") {
      summary.unchanged += 1;
      continue;
    }

    if (before.type === "invalid") {
      summary.invalid += 1;

      console.warn(
        `SKIP ${userDoc.id}: ${before.reason}`
      );

      continue;
    }

    // Preview mode never writes to Firestore.
    if (!apply) {
      summary.wouldUpdate += 1;

      console.log(
        `WOULD UPDATE ${userDoc.id}: ${before.fields.join(
          ", "
        )}`
      );

      continue;
    }

    try {
      // Re-read the current document inside the transaction
      // to avoid overwriting concurrent ranking updates.
      const outcome = await db.runTransaction(
        async (transaction) => {
          const current = await transaction.get(
            userDoc.ref
          );

          if (!current.exists) {
            return { type: "unchanged" };
          }

          const plan = planRankingUpdate(
            current.data() || {}
          );

          if (plan.type === "update") {
            transaction.update(
              userDoc.ref,
              plan.changes
            );
          }

          return plan;
        }
      );

      if (outcome.type === "update") {
        summary.updated += 1;

        console.log(
          `UPDATED ${userDoc.id}: ${outcome.fields.join(
            ", "
          )}`
        );
      } else if (outcome.type === "invalid") {
        summary.invalid += 1;

        console.warn(
          `SKIP ${userDoc.id}: ${outcome.reason}`
        );
      } else {
        summary.unchanged += 1;
      }
    } catch (error) {
      summary.errors += 1;

      console.error(
        `ERROR ${userDoc.id}: ${
          error.message || error
        }`
      );
    }
  }

  console.log("\nMigration summary:");

  for (const [key, value] of Object.entries(
    summary
  )) {
    console.log(`  ${key}: ${value}`);
  }

  // Treat unresolved data problems as an incomplete migration.
  if (summary.invalid || summary.errors) {
    console.error(
      "Review skipped/failed profiles. Existing values were not reset."
    );

    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    `Migration failed: ${error.message || error}`
  );

  process.exitCode = 1;
});
