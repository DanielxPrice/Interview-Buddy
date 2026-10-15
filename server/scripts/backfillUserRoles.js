require("dotenv").config();

const {
  admin,
  db,
} = require("../src/firebaseAdmin");

const {
  backfillUserRoles,
} = require(
  "../src/services/userRoleMigration"
);

async function main() {
  const dryRun = process.argv.includes(
    "--dry-run"
  );

  console.log(
    dryRun
      ? "Running user-role backfill in DRY RUN mode. No Firestore documents will be changed."
      : "Running user-role backfill. Missing or invalid roles will be set to 'user'."
  );

  const summary =
    await backfillUserRoles({
      db,
      admin,
      dryRun,
    });

  console.log("\nBackfill summary");

  console.log(
    `Users scanned: ${summary.usersScanned}`
  );

  console.log(
    `Missing roles: ${summary.missingRoles}`
  );

  console.log(
    `Invalid roles: ${summary.invalidRoles}`
  );

  console.log(
    `Valid roles preserved: ${summary.validRolesPreserved}`
  );

  console.log(
    `Roles written: ${summary.rolesWritten}`
  );

  console.log(
    `Errors: ${summary.errors}`
  );

  if (summary.errors > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    "User-role backfill failed:",
    error.message || error
  );

  process.exitCode = 1;
});