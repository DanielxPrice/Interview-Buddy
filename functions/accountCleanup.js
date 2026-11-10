/** Idempotent cleanup for SDK, console, and rollback Auth deletions. */
async function cleanupDeletedAccount(db, uid) {
  if (typeof uid !== "string" || !uid || uid.includes("/")) {
    throw new Error("A Firebase user ID is required.");
  }
  const query = db.collection("sessions").where("userId", "==", uid);
  while (true) {
    const snapshot = await query.limit(50).get();
    if (snapshot.empty) break;
    for (const document of snapshot.docs) await db.recursiveDelete(document.ref);
  }
  const claims = await db.collection("usernames").where("uid", "==", uid).get();
  for (const document of claims.docs) {
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(document.ref);
      if (current.exists && current.data().uid === uid) transaction.delete(document.ref);
    });
  }
  await db.recursiveDelete(db.collection("users").doc(uid));
}

module.exports = { cleanupDeletedAccount };
