/** Default is read-only. Run with --apply only after reviewing the dry run. */
require("dotenv").config();
const { admin, db } = require("../src/firebaseAdmin");
const { cleanupDeletedAccount } = require("../../functions/accountCleanup");

async function main() {
  const apply = process.argv.includes("--apply");
  // listDocuments also includes missing parent docs with orphan subcollections.
  const references = await db.collection("users").listDocuments();
  const candidates = new Set(references.map((reference) => reference.id));
  // Include session-only and reservation-only orphans with no users/{uid} tree.
  const sessions = await db.collection("sessions").select("userId").get();
  const claims = await db.collection("usernames").select("uid").get();
  for (const document of sessions.docs) {
    if (document.data().userId) candidates.add(document.data().userId);
  }
  for (const document of claims.docs) {
    if (document.data().uid) candidates.add(document.data().uid);
  }
  for (const uid of candidates) {
    try {
      await admin.auth().getUser(uid);
      continue;
    } catch (error) {
      // Network, permission, and other errors must never imply an orphan.
      if (error.code !== "auth/user-not-found") throw error;
    }
    console.log(`${apply ? "Removing" : "Would remove"} orphan UID=${uid}`);
    if (apply) await cleanupDeletedAccount(db, uid);
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
