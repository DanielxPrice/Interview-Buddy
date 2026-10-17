require("dotenv").config();

const {
  admin,
  db,
} = require("../src/firebaseAdmin");

const {
  syncAuthUsersToFirestore,
} = require(
  "../src/services/authUserProfileSync"
);

async function main() {
  const dryRun =
    process.argv.includes("--dry-run");

  console.log(
    dryRun
      ? "\nDRY RUN: No Firestore profiles will be changed.\n"
      : "\nSynchronizing Firebase Authentication users with Firestore...\n"
  );

  const { summary, actions } =
    await syncAuthUsersToFirestore({
      auth: admin.auth(),
      db,
      admin,
      dryRun,
    });

  console.log("Account actions");
  console.log("------------------------------");

  for (const action of actions) {
    console.log(
      [
        action.action,
        action.email || "(no email)",
        `UID=${action.uid}`,
        action.username
          ? `username=${action.username}`
          : "",
        action.role
          ? `role=${action.role}`
          : "",
        action.fields
          ? `fields=${action.fields.join(",")}`
          : "",
        action.reason
          ? `reason=${action.reason}`
          : "",
      ]
        .filter(Boolean)
        .join(" | ")
    );
  }

  console.log(
    "\nSynchronization summary"
  );

  console.log(
    "------------------------------"
  );

  console.log(
    `Authentication users: ${summary.authUsersScanned}`
  );

  console.log(
    `Existing Firestore profiles: ${summary.firestoreProfilesFound}`
  );

  console.log(
    `Complete profiles: ${summary.completeProfiles}`
  );

  console.log(
    `Missing profiles: ${summary.missingProfiles}`
  );

  console.log(
    `Incomplete profiles: ${summary.incompleteProfiles}`
  );

  console.log(
    `Profiles written: ${summary.profilesWritten}`
  );

  console.log(
    `Skipped without email: ${summary.skippedWithoutEmail}`
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
    "Authentication/Firestore synchronization failed:",
    error.message || error
  );

  process.exitCode = 1;
});