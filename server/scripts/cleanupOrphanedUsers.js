/** Default is read-only. Run with --apply only after reviewing the dry run. */
require("dotenv").config();
const { admin, db } = require("../src/firebaseAdmin");
const { cleanupDeletedAccount } = require("../../functions/accountCleanup");

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`Project: ${admin.app().options.projectId}; mode: ${apply ? "APPLY" : "DRY RUN"}`);
  let kept = 0;
  let orphaned = 0;
  // listDocuments also includes missing parent docs with orphan subcollections.
  const references = await db.collection("users").listDocuments();
  const candidates = new Set(references.map((reference) => reference.id));
  // Include session-, reservation- and relationship-only orphans with no users/{uid} tree.
  const sessions = await db.collection("sessions").select("userId").get();
  const claims = await db.collection("usernames").select("uid").get();
  for (const document of sessions.docs) {
    if (document.data().userId) candidates.add(document.data().userId);
  }
  for (const document of claims.docs) {
    if (document.data().uid) candidates.add(document.data().uid);
  }
  // A deleted account might leave only a top-level friendRelationship record.
  // A dry run enumerates BOTH participants, then checks each against Auth.
  const relationships = await db.collection("friendRelationships").select("participants").get();
  for (const document of relationships.docs) {
    const participants = document.data().participants;
    if (!Array.isArray(participants) || participants.length !== 2) {
      throw new Error(`Invalid participants on relationship ${document.id}; stopping cleanup.`);
    }
    for (const uid of participants) candidates.add(uid);
  }
  for (const uid of candidates) {
    if (typeof uid !== "string" || !uid || uid.includes("/")) {
      throw new Error("Invalid owner UID found; stopping without deleting this candidate.");
    }
    try {
      await admin.auth().getUser(uid);
      kept += 1;
      continue;
    } catch (error) {
      // Network, permission, and other errors must never imply an orphan.
      if (error.code !== "auth/user-not-found") throw error;
    }
    // Preserve legacy/mis-keyed profiles if their stored UID still exists.
    const profile = await db.collection("users").doc(uid).get();
    const storedUid = profile.data()?.uid;
    if (storedUid && storedUid !== uid) {
      try {
        await admin.auth().getUser(storedUid);
        console.log(`Keeping legacy profile UID=${uid}: stored UID is authenticated.`);
        kept += 1;
        continue;
      } catch (error) {
        if (error.code !== "auth/user-not-found") throw error;
      }
    }
    orphaned += 1;
    console.log(`${apply ? "Removing" : "Would remove"} orphan UID=${uid}`);
    if (apply) await cleanupDeletedAccount(db, uid);
  }
  console.log(`Completed: ${candidates.size} UIDs checked; ${kept} authenticated/legacy accounts kept; ${orphaned} orphans ${apply ? "removed" : "found"}.`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
