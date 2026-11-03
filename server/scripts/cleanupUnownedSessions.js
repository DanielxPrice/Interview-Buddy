
"use strict";

/**
 * Interview Buddy - one-time cleanup of sessions without a current Auth owner.
 *
 * Run from server/:
 *   node scripts/cleanupUnownedSessions.js --dry-run
 *
 * After reviewing the output AND backing up Firestore:
 *   node scripts/cleanupUnownedSessions.js --apply \
 *     --project=YOUR_PROJECT_ID --plan=DRY_RUN_HASH \
 *     --max-sessions=APPROVED_COUNT \
 *     --confirm=DELETE_UNOWNED_SESSIONS
 *
 * A dry run NEVER writes. Apply recursively deletes approved session trees.
 * This script does NOT modify Authentication accounts or users/{uid}.
 */

require("dotenv").config();

const crypto = require("node:crypto");
const { admin, db } = require("../src/firebaseAdmin");

const OWNER_FIELDS = [
  "userId", "uid", "ownerUid", "ownerId", "firebaseUid",
  "userUID", "user_id", "createdBy", "user", "owner",
];
const MAX_DEPTH = 12;
const MAX_NESTED_PER_SESSION = 5000;

function option(name) {
  const matches = process.argv.slice(2).filter((arg) =>
    arg.startsWith(`--${name}=`)
  );
  if (matches.length > 1) throw new Error(`Duplicate --${name}`);
  return matches.length ? matches[0].slice(name.length + 3) : null;
}

function version(snapshot) {
  if (!snapshot.exists) return null;
  const t = snapshot.updateTime;
  if (!t) throw new Error(`Missing Firestore timestamp: ${snapshot.ref.path}`);
  return `${t.seconds}:${t.nanoseconds}`;
}

async function getAuthUids() {
  const uids = new Set();
  let next;
  do {
    const page = await admin.auth().listUsers(1000, next);
    if (!page || !Array.isArray(page.users)) {
      throw new Error("Authentication listing was incomplete");
    }
    for (const user of page.users) uids.add(user.uid);
    next = page.pageToken;
  } while (next);
  return uids;
}

// Collect descendant document versions so the deletion plan accounts for
// responses and any deeper subcollections. Do not output their contents.
async function inspectChildren(parent, result, depth = 0) {
  if (depth > MAX_DEPTH) {
    throw new Error(`Nested depth limit reached: ${parent.path}`);
  }

  const collections = await parent.listCollections();
  for (const collection of collections) {
    const refs = await collection.listDocuments();
    for (const ref of refs) {
      if (result.children.length >= MAX_NESTED_PER_SESSION) {
        throw new Error(`Nested document limit reached: ${result.id}`);
      }
      const doc = await ref.get();
      result.children.push({ path: ref.path, version: version(doc) });

      if (doc.exists) {
        const data = doc.data() || {};
        for (const field of OWNER_FIELDS) {
          if (!Object.prototype.hasOwnProperty.call(data, field)) continue;
          const value = data[field];
          if (value == null || value === "") continue;
          // A matching orphaned root owner is not a conflict.
          if (
            result.kind === "uid-not-in-auth" &&
            typeof value === "string" &&
            value === result.userId
          ) continue;
          result.review = true;
          result.reviewReasons.add("Nested document contains an owner-like field");
        }
      }
      await inspectChildren(ref, result, depth + 1);
    }
  }
}

async function scan(authUids) {
  const snapshot = await db.collection("sessions").get();
  const candidates = [];
  const blocked = [];
  let activeSessions = 0;
  let missingUid = 0;
  let absentFromAuth = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data() || {};
    const owner = data.userId;
    const validOwner = typeof owner === "string" && owner.trim().length > 0;

    if (validOwner && authUids.has(owner)) {
      activeSessions += 1;
      continue;
    }

    const result = {
      id: doc.id,
      path: doc.ref.path,
      version: version(doc),
      kind: validOwner ? "uid-not-in-auth" : "no-valid-userId",
      userId: validOwner ? owner : null,
      children: [],
      review: false,
      reviewReasons: new Set(),
    };

    if (validOwner) absentFromAuth += 1;
    else missingUid += 1;

    // A different ownership field may connect this record to an active user.
    for (const field of OWNER_FIELDS) {
      if (field === "userId") continue;
      if (!Object.prototype.hasOwnProperty.call(data, field)) continue;
      if (data[field] == null || data[field] === "") continue;
      result.review = true;
      result.reviewReasons.add(`Root has alternate owner field: ${field}`);
    }

    await inspectChildren(doc.ref, result);
    result.children.sort((a, b) => a.path.localeCompare(b.path));

    if (result.review) blocked.push(result);
    else candidates.push(result);
  }

  candidates.sort((a, b) => a.path.localeCompare(b.path));
  blocked.sort((a, b) => a.path.localeCompare(b.path));

  return {
    scanned: snapshot.size, activeSessions,
    missingUid, absentFromAuth, candidates, blocked,
  };
}

function publicEntry(entry) {
  return {
    path: entry.path,
    version: entry.version,
    kind: entry.kind,
    userId: entry.userId,
    children: entry.children,
  };
}

function digest(project, target, authUids, report) {
  const currentUsers = [...authUids].sort();
  return crypto.createHash("sha256").update(JSON.stringify({
    project,
    target,
    currentUsers,
    candidates: report.candidates.map(publicEntry),
    blocked: report.blocked.map(publicEntry),
  })).digest("hex");
}

async function confirmCandidateIsStillSafe(entry, authUids) {
  const doc = await db.doc(entry.path).get();
  if (!doc.exists || version(doc) !== entry.version) {
    throw new Error(`Changed since preview: ${entry.path}`);
  }

  const data = doc.data() || {};
  if (entry.kind === "no-valid-userId") {
    if (typeof data.userId === "string" && data.userId.trim()) {
      throw new Error(`A userId was assigned: ${entry.path}`);
    }
  } else {
    if (data.userId !== entry.userId) {
      throw new Error(`Owner changed: ${entry.path}`);
    }
    // Check Auth again: a previously deleted UID could have been restored.
    try {
      await admin.auth().getUser(entry.userId);
      throw new Error(`Owner now exists in Authentication: ${entry.path}`);
    } catch (error) {
      if (error.code !== "auth/user-not-found") throw error;
    }
  }

  // Reinspect nested paths immediately before recursive deletion.
  const current = {
    id: entry.id, kind: entry.kind, userId: entry.userId,
    children: [], review: false, reviewReasons: new Set(),
  };
  await inspectChildren(doc.ref, current);
  current.children.sort((a, b) => a.path.localeCompare(b.path));
  if (current.review ||
      JSON.stringify(current.children) !== JSON.stringify(entry.children)) {
    throw new Error(`Nested documents changed or need review: ${entry.path}`);
  }

  // Defend against an Auth UID appearing between scan and delete.
  if (entry.userId && authUids.has(entry.userId)) {
    throw new Error(`Owner exists in Authentication: ${entry.path}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const allowed = [
    "--dry-run", "--apply", "--project=", "--plan=",
    "--max-sessions=", "--confirm=",
  ];
  for (const arg of args) {
    if (!allowed.some((a) => a.endsWith("=") ? arg.startsWith(a) : arg === a)) {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  const apply = args.includes("--apply");
  if (apply && args.includes("--dry-run")) {
    throw new Error("Choose either --dry-run or --apply");
  }

  const authEmulator = Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);
  const firestoreEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  if (authEmulator !== firestoreEmulator) {
    throw new Error("Refusing mixed live/emulator Auth and Firestore");
  }

  const project = admin.app().options.projectId;
  if (!project) throw new Error("Missing Firebase project ID");
  const target = authEmulator ? "EMULATORS" : "LIVE FIREBASE";
  console.log(`Project: ${project}`);
  console.log(`Target: ${target}`);
  console.log(`Mode: ${apply ? "APPLY / PERMANENT DELETE" : "DRY RUN / READ ONLY"}`);

  const authUids = await getAuthUids();
  const report = await scan(authUids);
  const hash = digest(project, target, authUids, report);

  console.log(`\nAuthentication users: ${authUids.size}`);
  console.log(`Sessions scanned: ${report.scanned}`);
  console.log(`Sessions with current Auth owner (preserved): ${report.activeSessions}`);
  console.log(`Sessions missing userId: ${report.missingUid}`);
  console.log(`Sessions with UID missing from Auth: ${report.absentFromAuth}`);

  for (const entry of report.candidates) {
    console.log(`WOULD DELETE ${entry.path} (${entry.kind}; ${entry.children.length} nested paths)`);
  }
  for (const entry of report.blocked) {
    console.log(`NEEDS REVIEW ${entry.path} (${[...entry.reviewReasons].join("; ")})`);
  }

  const nestedCount = report.candidates.reduce((n, e) => n + e.children.length, 0);
  console.log(`\nApproved session candidates: ${report.candidates.length}`);
  console.log(`Nested document paths in approved candidates: ${nestedCount}`);
  console.log(`Blocked sessions requiring review: ${report.blocked.length}`);
  console.log(`Plan hash: ${hash}`);

  if (!apply) {
    console.log("DRY RUN COMPLETE: no records deleted.");
    return;
  }

  if (option("project") !== project ||
      option("confirm") !== "DELETE_UNOWNED_SESSIONS" ||
      option("plan") !== hash) {
    throw new Error("Apply refused: project, confirmation, or plan hash mismatch");
  }
  const limit = option("max-sessions");
  if (!limit || !/^(0|[1-9][0-9]*)$/.test(limit) ||
      Number(limit) !== report.candidates.length) {
    throw new Error("--max-sessions must equal the approved candidate count");
  }
  if (authUids.size === 0) {
    throw new Error("Refusing deletion: Authentication returned zero users");
  }
  if (report.blocked.length) {
    throw new Error("Refusing deletion: first investigate NEEDS REVIEW records");
  }

  let deleted = 0;
  for (const entry of report.candidates) {
    await confirmCandidateIsStillSafe(entry, authUids);
    // recursiveDelete removes responses and any deeper nested subcollections.
    await db.recursiveDelete(db.doc(entry.path));
    deleted += 1;
    console.log(`DELETED ${entry.path} (${entry.children.length} previously observed nested paths)`);
  }
  console.log(`\nDeleted ${deleted} session document trees.`);
  console.log("Run --dry-run again to verify no unowned sessions remain.");
}

main().catch((error) => {
  console.error(`STOPPED: ${error.message || error}`);
  console.error("If --apply was used, deletion may be partial. Run --dry-run again.");
  process.exitCode = 1;
});
