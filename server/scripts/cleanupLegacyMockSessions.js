
"use strict";

/**
 * Interview Buddy — Legacy Mock Session Cleanup
 *
 * One-time cleanup of the 23 specifically identified
 * legacy mock sessions in Firestore.
 *
 * This script:
 * - Is read-only by default.
 * - Targets only the 23 explicitly listed session IDs.
 * - Verifies their expected document fields.
 * - Refuses to delete documents with subcollections.
 * - Requires explicit confirmation before deletion.
 * - Checks that records have not changed before deletion.
 *
 * Run from the server directory:
 *
 * Preview:
 * node scripts/cleanupLegacyMockSessions.js --dry-run
 *
 * Apply:
 * node scripts/cleanupLegacyMockSessions.js --apply --project=PROJECT_ID --plan=HASH --confirm=DELETE_23_LEGACY_MOCKS
 */

require("dotenv").config();

const crypto = require("node:crypto");

const { admin, db } = require("../src/firebaseAdmin");

// Expected fields found during the read-only investigation.
const EXPECTED_FIELDS = [
  "experienceLevel",
  "jobRole",
  "mode",
  "status",
  "updatedAt",
].sort();

// Exact legacy mock sessions identified in Firestore.
const IDS = [
  "mock-session-1790033203295",
  "mock-session-1790033745879",
  "mock-session-1790035523362",
  "mock-session-1790377573415",
  "mock-session-1790383549184",
  "mock-session-1790911418484",
  "mock-session-1790911494821",
  "mock-session-1790926979048",
  "mock-session-1790977937098",
  "mock-session-1791245842931",
  "mock-session-1791246678093",
  "mock-session-1791247629893",
  "mock-session-1791247713487",
  "mock-session-1791249892134",
  "mock-session-1791255849080",
  "mock-session-1791332304889",
  "mock-session-1791426989402",
  "mock-session-1791427045970",
  "mock-session-1791429733591",
  "mock-session-1791607411580",
  "mock-session-1791914746508",
  "mock-session-1791936891161",
  "mock-session-1791937113689",
];

/**
 * Read a named command-line argument.
 *
 * Example:
 * --project=interview-buddy-c9912
 */
function option(name) {
  const values = process.argv
    .slice(2)
    .filter((arg) => arg.startsWith(`--${name}=`));

  if (values.length > 1) {
    throw new Error(`Duplicate --${name}`);
  }

  return values.length
    ? values[0].slice(name.length + 3)
    : null;
}

/**
 * Verify that the document contains exactly
 * the expected five legacy mock fields.
 *
 * If additional fields exist, deletion is blocked.
 */
function checkShape(doc) {
  const fields = Object.keys(doc.data() || {}).sort();

  return (
    JSON.stringify(fields) ===
    JSON.stringify(EXPECTED_FIELDS)
  );
}

/**
 * Inspect one specifically identified session.
 *
 * Returns null if the document no longer exists.
 *
 * Refuses to proceed if:
 * - The document fields have changed.
 * - The document contains subcollections.
 * - Its Firestore update timestamp is missing.
 */
async function inspectOne(id) {
  const ref = db.collection("sessions").doc(id);

  const doc = await ref.get();

  if (!doc.exists) {
    return null;
  }

  if (!checkShape(doc)) {
    throw new Error(
      `BLOCKED ${id}: fields no longer match ` +
        "the inspected legacy format"
    );
  }

  const children = await ref.listCollections();

  if (children.length) {
    throw new Error(
      `BLOCKED ${id}: has subcollections (` +
        children.map((collection) => collection.id).join(", ") +
        ")"
    );
  }

  if (!doc.updateTime) {
    throw new Error(
      `BLOCKED ${id}: missing update timestamp`
    );
  }

  return {
    id,
    updateTime: doc.updateTime.toMillis(),
  };
}

/**
 * Run the cleanup process.
 */
async function main() {
  const args = process.argv.slice(2);

  const allowed = [
    "--dry-run",
    "--apply",
    "--project=",
    "--plan=",
    "--confirm=",
  ];

  // Reject unexpected command-line arguments.
  for (const arg of args) {
    const recognized = allowed.some((allowedArg) =>
      allowedArg.endsWith("=")
        ? arg.startsWith(allowedArg)
        : arg === allowedArg
    );

    if (!recognized) {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  const apply = args.includes("--apply");

  if (apply && args.includes("--dry-run")) {
    throw new Error(
      "Choose --dry-run or --apply, not both."
    );
  }

  // Identify the connected Firebase project.
  const projectId = admin.app().options.projectId;

  if (!projectId) {
    throw new Error("Missing Firebase project ID");
  }

  // Prevent mixed live/emulator configuration.
  const authEmulator = Boolean(
    process.env.FIREBASE_AUTH_EMULATOR_HOST
  );

  const firestoreEmulator = Boolean(
    process.env.FIRESTORE_EMULATOR_HOST
  );

  if (authEmulator !== firestoreEmulator) {
    throw new Error(
      "Mixed live/emulator configuration"
    );
  }

  const target = firestoreEmulator
    ? "EMULATOR"
    : "LIVE FIRESTORE";

  console.log(`Project: ${projectId}`);
  console.log(`Target: ${target}`);

  console.log(
    `Mode: ${
      apply
        ? "PERMANENT DELETE"
        : "DRY RUN (no writes)"
    }`
  );

  // Inspect all 23 explicitly named documents.
  const entries = [];

  for (const id of IDS) {
    const entry = await inspectOne(id);

    if (entry) {
      entries.push(entry);
    }
  }

  // Generate a fingerprint of the proposed deletion.
  //
  // The plan includes the project, environment,
  // document IDs, and Firestore update timestamps.
  const plan = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        projectId,
        target,
        entries,
      })
    )
    .digest("hex");

  console.log(`Named IDs reviewed: ${IDS.length}`);

  console.log(
    `Existing safe-shape candidates: ${entries.length}`
  );

  // Display exactly which documents would be deleted.
  for (const entry of entries) {
    console.log(
      `${apply ? "DELETE" : "WOULD DELETE"} ` +
        `sessions/${entry.id}`
    );
  }

  console.log(`Plan hash: ${plan}`);

  // No database writes in dry-run mode.
  if (!apply) {
    console.log(
      "DRY RUN COMPLETE: no records deleted."
    );

    return;
  }

  // Require explicit confirmation before deleting.
  if (
    option("project") !== projectId ||
    option("confirm") !== "DELETE_23_LEGACY_MOCKS" ||
    option("plan") !== plan
  ) {
    throw new Error(
      "Apply refused: project, confirmation, " +
        "or plan hash mismatch"
    );
  }

  let deleted = 0;

  for (const item of entries) {
    // Reinspect each document before deletion.
    const current = await inspectOne(item.id);

    if (
      !current ||
      current.updateTime !== item.updateTime
    ) {
      throw new Error(
        `STOPPED: sessions/${item.id} ` +
          "changed since preview"
      );
    }

    const snap = await db
      .collection("sessions")
      .doc(item.id)
      .get();

    if (
      !snap.exists ||
      snap.updateTime.toMillis() !== item.updateTime
    ) {
      throw new Error(
        `STOPPED: sessions/${item.id} ` +
          "changed before delete"
      );
    }

    // Delete only this document.
    //
    // The lastUpdateTime precondition protects against
    // concurrent modifications.
    await snap.ref.delete({
      lastUpdateTime: snap.updateTime,
    });

    deleted += 1;

    console.log(
      `DELETED sessions/${item.id}`
    );
  }

  console.log(
    `Finished: deleted ${deleted} ` +
      "legacy mock sessions."
  );
}

main().catch((error) => {
  console.error(
    `STOPPED: ${error.message || error}`
  );

  console.error(
    "If applying, some deletions may already have " +
      "completed. Re-run the dry run."
  );

  process.exitCode = 1;
});
