
"use strict";

const PAGE_SIZE = 1000;

function parseArgs(argv) {
  const value = (key) => {
    const found = argv.find((argument) =>
      argument.startsWith(`--${key}=`)
    );

    return found
      ? found.slice(key.length + 3)
      : "";
  };

  const project = value("project");
  const all = argv.includes("--all-existing");

  const uids = value("uids")
    .split(",")
    .map((uid) => uid.trim())
    .filter(Boolean);

  const apply = argv.includes("--apply");

  const cutoffText =
    value("before") ||
    (!apply ? new Date().toISOString() : "");

  const cutoff = Date.parse(cutoffText);

  if (!project || !Number.isFinite(cutoff)) {
    throw new Error(
      "Provide --project=PROJECT_ID and a valid --before=ISO_DATE when applying."
    );
  }

  if (all === (uids.length > 0)) {
    throw new Error(
      "Choose exactly one of --all-existing or --uids=UID1,UID2."
    );
  }

  if (
    apply &&
    all &&
    !argv.includes(
      "--acknowledge-email-ownership-risk"
    )
  ) {
    throw new Error(
      "Bulk verification requires --acknowledge-email-ownership-risk."
    );
  }

  return {
    project,
    all,
    uids,
    apply,
    cutoff,
    cutoffText: new Date(cutoff).toISOString(),
  };
}

async function runMigration(auth, options) {
  const allowedUids = new Set(options.uids);

  const summary = {
    scanned: 0,
    eligible: 0,
    updated: 0,
    alreadyVerified: 0,
    disabled: 0,
    missingEmail: 0,
    createdAfterCutoff: 0,
    missingCreationDate: 0,
    notSelected: 0,
    changedBeforeUpdate: 0,
    failed: 0,
  };

  let pageToken;

  do {
    const page = await auth.listUsers(
      PAGE_SIZE,
      pageToken
    );

    for (const user of page.users) {
      summary.scanned += 1;

      if (
        !options.all &&
        !allowedUids.has(user.uid)
      ) {
        summary.notSelected += 1;
        continue;
      }

      if (!user.email) {
        summary.missingEmail += 1;
        continue;
      }

      if (user.disabled) {
        summary.disabled += 1;
        continue;
      }

      if (user.emailVerified) {
        summary.alreadyVerified += 1;
        continue;
      }

      const created = Date.parse(
        user.metadata?.creationTime || ""
      );

      if (!Number.isFinite(created)) {
        summary.missingCreationDate += 1;
        continue;
      }

      if (created > options.cutoff) {
        summary.createdAfterCutoff += 1;
        continue;
      }

      summary.eligible += 1;

      // Preview mode never modifies Firebase.
      if (!options.apply) {
        continue;
      }

      try {
        // Check again immediately before updating.
        // This avoids marking a recently changed
        // email address as verified.
        const current = await auth.getUser(
          user.uid
        );

        const currentCreated = Date.parse(
          current.metadata?.creationTime || ""
        );

        if (
          current.email !== user.email ||
          current.disabled ||
          current.emailVerified ||
          !Number.isFinite(currentCreated) ||
          currentCreated !== created ||
          currentCreated > options.cutoff
        ) {
          summary.changedBeforeUpdate += 1;
          continue;
        }

        await auth.updateUser(user.uid, {
          emailVerified: true,
        });

        summary.updated += 1;
      } catch (error) {
        summary.failed += 1;

        console.error(
          `Failed to verify UID ${user.uid}: ${
            error.code || error.message
          }`
        );
      }
    }

    pageToken = page.pageToken;
  } while (pageToken);

  return summary;
}

async function main() {
  // Validate command arguments before accessing
  // Firebase administrative credentials.
  const args = parseArgs(process.argv.slice(2));

  require("dotenv").config();

  const {
    admin,
  } = require("../src/firebaseAdmin");

  const configuredProject =
    admin.app().options.projectId;

  if (args.project !== configuredProject) {
    throw new Error(
      `Project mismatch: supplied ${args.project}, configured ${configuredProject}.`
    );
  }

  console.log(
    `Mode: ${args.apply ? "APPLY" : "DRY RUN"}`
  );

  console.log(
    `Firebase project: ${configuredProject}`
  );

  console.log(
    `Creation cutoff (UTC): ${args.cutoffText}`
  );

  console.log(
    `Target: ${
      args.all
        ? "ALL existing accounts"
        : `${args.uids.length} specified UID(s)`
    }`
  );

  if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    console.log(
      `Using Firebase Auth emulator: ${
        process.env.FIREBASE_AUTH_EMULATOR_HOST
      }`
    );
  }

  const result = await runMigration(
    admin.auth(),
    args
  );

  console.log(
    "Summary:",
    JSON.stringify(result, null, 2)
  );

  if (!args.apply) {
    console.log(
      "Dry run completed; no accounts modified."
    );

    console.log(
      `To apply, reuse --before=${args.cutoffText} and add --apply.`
    );
  }

  if (result.failed > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  runMigration,
};
