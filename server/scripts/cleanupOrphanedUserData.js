
"use strict";

/**
 * Interview Buddy — Orphaned Firestore User Cleanup
 *
 * Compares Firebase Authentication UIDs against Firestore user
 * profiles and interview sessions.
 *
 * Dry run:
 *   node scripts/cleanupOrphanedUserData.js --dry-run
 *
 * Permanent deletion requires project confirmation,
 * a matching dry-run plan hash, and deletion limits.
 *
 * Never deletes Firebase Authentication accounts.
 */

require("dotenv").config();

const crypto = require("node:crypto");
const { admin, db } = require("../src/firebaseAdmin");

function flag(name) {
  const prefix = `--${name}=`;

  const values = process.argv
    .slice(2)
    .filter((arg) => arg.startsWith(prefix));

  if (values.length > 1) {
    throw new Error(`Duplicate --${name} option.`);
  }

  return values.length
    ? values[0].slice(prefix.length)
    : null;
}

function integerFlag(name) {
  const value = flag(name);

  if (
    value === null ||
    !/^(0|[1-9][0-9]*)$/.test(value)
  ) {
    throw new Error(
      `--${name}= must be a nonnegative whole number.`
    );
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`--${name}= is too large.`);
  }

  return parsed;
}

/**
 * Retrieve ALL Firebase Authentication UIDs.
 *
 * Firebase Admin returns users in pages of up to 1000.
 * If enumeration fails, no deletion will be attempted.
 */
async function allAuthUids(auth) {
  const uids = new Set();
  let token;

  do {
    const page = await auth.listUsers(1000, token);

    if (!page || !Array.isArray(page.users)) {
      throw new Error(
        "Firebase Auth did not return a complete users page."
      );
    }

    for (const user of page.users) {
      uids.add(user.uid);
    }

    token = page.pageToken;
  } while (token);

  return uids;
}

/**
 * Inspect users and sessions.
 *
 * The Firestore document ID is the authoritative user UID.
 * A profile is orphaned when that ID does not exist in Auth.
 *
 * Sessions are checked separately because a deleted user's
 * profile might already be gone while sessions remain.
 */
async function inspectFirestore(authUids) {
  const orphans = new Map();

  function record(uid) {
    if (!orphans.has(uid)) {
      orphans.set(uid, {
        profile: false,
        sessions: [],
      });
    }

    return orphans.get(uid);
  }

  // Include parent references that may still have nested
  // subcollections even if the parent document was deleted.
  const userRefs = await db
    .collection("users")
    .listDocuments();

  for (const ref of userRefs) {
    if (!authUids.has(ref.id)) {
      record(ref.id).profile = true;
    }
  }

  let scannedSessions = 0;
  let sessionsWithoutOwner = 0;

  const stream = db
    .collection("sessions")
    .select("userId")
    .stream();

  for await (const doc of stream) {
    scannedSessions += 1;

    const uid = doc.data()?.userId;

    if (
      typeof uid !== "string" ||
      !uid.trim()
    ) {
      // Cannot safely determine whose session this is.
      sessionsWithoutOwner += 1;
      continue;
    }

    if (!authUids.has(uid)) {
      record(uid).sessions.push(doc.id);
    }
  }

  const sorted = [...orphans.entries()].sort(
    ([a], [b]) => a.localeCompare(b)
  );

  for (const [, entry] of sorted) {
    entry.sessions.sort();
  }

  return {
    sorted,
    profilesScanned: userRefs.length,
    scannedSessions,
    sessionsWithoutOwner,
  };
}

/**
 * Recursively remove sessions owned by one orphaned UID.
 *
 * This also removes responses, evaluationAttempts,
 * and other subcollections underneath each session.
 */
async function deleteOwnedSessions(
  uid,
  maxSessions,
  counter
) {
  const query = db
    .collection("sessions")
    .where("userId", "==", uid)
    .limit(40);

  while (true) {
    const batch = await query.get();

    if (batch.empty) {
      break;
    }

    for (const doc of batch.docs) {
      if (counter.deleted >= maxSessions) {
        throw new Error(
          "Session deletion cap reached. " +
          "Stopping; cleanup may be partial."
        );
      }

      await db.recursiveDelete(doc.ref);

      counter.deleted += 1;
    }
  }
}

async function main() {
  const argv = process.argv.slice(2);

  const legal = [
    "--dry-run",
    "--apply",
    "--allow-empty-auth",
    "--project=",
    "--plan=",
    "--confirm=",
    "--max-users=",
    "--max-sessions=",
  ];

  for (const arg of argv) {
    const recognized = legal.some((item) =>
      item.endsWith("=")
        ? arg.startsWith(item)
        : arg === item
    );

    if (!recognized) {
      throw new Error(`Unrecognized option: ${arg}`);
    }
  }

  const apply = argv.includes("--apply");

  if (apply && argv.includes("--dry-run")) {
    throw new Error(
      "Choose --apply or --dry-run."
    );
  }

  // Never compare an Auth emulator with live Firestore,
  // or vice versa.
  const authEmulator = Boolean(
    process.env.FIREBASE_AUTH_EMULATOR_HOST
  );

  const firestoreEmulator = Boolean(
    process.env.FIRESTORE_EMULATOR_HOST
  );

  if (authEmulator !== firestoreEmulator) {
    throw new Error(
      "Refusing to compare a live service " +
      "with an emulator."
    );
  }

  const environment = authEmulator
    ? "EMULATORS"
    : "LIVE FIREBASE";

  const projectId = admin.app().options.projectId;

  if (!projectId) {
    throw new Error(
      "Firebase project ID is missing."
    );
  }

  console.log(`Project: ${projectId}`);
  console.log(`Environment: ${environment}`);

  console.log(
    `Mode: ${
      apply
        ? "APPLY (PERMANENT DELETE)"
        : "DRY RUN (READ ONLY)"
    }`
  );

  // All Auth and Firestore reads must succeed before
  // we consider deleting any data.
  const auth = admin.auth();

  const authUids = await allAuthUids(auth);

  const report = await inspectFirestore(authUids);

  const orphanSessions = report.sorted.reduce(
    (total, [, entry]) =>
      total + entry.sessions.length,
    0
  );

  const orphanProfiles = report.sorted.filter(
    ([, entry]) => entry.profile
  ).length;

  // The hash binds a future apply command to the exact
  // project, environment, and discovered deletion plan.
  const digest = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        projectId,
        environment,
        orphans: report.sorted,
      })
    )
    .digest("hex");

  console.log(
    `\nAuthentication users: ${authUids.size}`
  );

  console.log(
    `User document paths inspected: ${report.profilesScanned}`
  );

  console.log(
    `Sessions inspected: ${report.scannedSessions}`
  );

  console.log(
    `Orphaned UID groups: ${report.sorted.length}`
  );

  console.log(
    `Orphaned user paths: ${orphanProfiles}`
  );

  console.log(
    `Orphaned sessions: ${orphanSessions}`
  );

  console.log(
    `Sessions without valid userId (not deleted): ` +
    report.sessionsWithoutOwner
  );

  for (const [uid, entry] of report.sorted) {
    console.log(
      `  ${uid}: ` +
      `userPath=${entry.profile ? "yes" : "no"}, ` +
      `sessions=${entry.sessions.length}`
    );
  }

  console.log(`\nPlan hash: ${digest}`);

  // DEFAULT: READ ONLY.
  if (!apply) {
    console.log(
      "DRY RUN COMPLETE. No data was deleted."
    );
    return;
  }

  // Require explicit project and destructive-operation
  // confirmation before allowing writes.
  if (
    flag("project") !== projectId ||
    flag("confirm") !== "DELETE_ORPHAN_DATA"
  ) {
    throw new Error(
      "Apply requires --project=ACTUAL_ID " +
      "and --confirm=DELETE_ORPHAN_DATA."
    );
  }

  if (flag("plan") !== digest) {
    throw new Error(
      "Plan hash does not match. " +
      "Re-run --dry-run and review changes."
    );
  }

  const maxUsers = integerFlag("max-users");
  const maxSessions = integerFlag("max-sessions");

  if (
    report.sorted.length > maxUsers ||
    orphanSessions > maxSessions
  ) {
    throw new Error(
      "Number of orphan UIDs or sessions " +
      "exceeds the approved deletion cap."
    );
  }

  // A zero-user Auth result could mean an empty project
  // or an unexpectedly wrong environment.
  if (
    authUids.size === 0 &&
    !argv.includes("--allow-empty-auth")
  ) {
    throw new Error(
      "Auth returned zero users. " +
      "Refusing bulk delete without --allow-empty-auth."
    );
  }

  const counter = { deleted: 0 };
  let removedUsers = 0;

  for (const [uid] of report.sorted) {
    // Recheck Authentication immediately before deletion.
    // If this UID now exists, preserve its Firestore data.
    try {
      await auth.getUser(uid);

      console.log(
        `SKIPPED ${uid}: now exists in Authentication`
      );

      continue;
    } catch (error) {
      if (error.code !== "auth/user-not-found") {
        throw error;
      }
    }

    // Delete associated interview sessions and their
    // nested responses / evaluation attempts.
    await deleteOwnedSessions(
      uid,
      maxSessions,
      counter
    );

    // Delete the user document and ALL of its
    // nested Firestore subcollections.
    await db.recursiveDelete(
      db.collection("users").doc(uid)
    );

    removedUsers += 1;

    console.log(
      `DELETED orphan UID ${uid}`
    );
  }

  console.log(
    `\nFinished: cleaned ${removedUsers} ` +
    `orphan UID groups and ${counter.deleted} sessions.`
  );

  console.log(
    "Run --dry-run again to confirm " +
    "no orphan records remain."
  );

  if (report.sessionsWithoutOwner) {
    console.warn(
      "Review sessions without userId separately; " +
      "ownership is unknown."
    );
  }
}

main().catch((error) => {
  console.error(
    `CLEANUP STOPPED: ${error.message || error}`
  );

  console.error(
    "If --apply was running, some deletions may " +
    "already have completed. Re-run --dry-run."
  );

  process.exitCode = 1;
});
