
/** Remove the data owned by the authenticated Firebase user. */
function createAccountDeletionService({ db, authClient }) {
  if (!db || typeof db.recursiveDelete !== "function") {
    throw new Error("Firestore recursiveDelete is required.");
  }
  if (!authClient || typeof authClient.deleteUser !== "function") {
    throw new Error("Firebase Admin Authentication is required.");
  }

  async function removeSessions(uid) {
    const query = db.collection("sessions").where("userId", "==", uid);
    let count = 0;
    let remaining = true;

    while (remaining) {
      const snapshot = await query.limit(50).get();
      remaining = !snapshot.empty;

      for (const document of snapshot.docs) {
        // Also removes sessions/{id}/responses and future nested data.
        await db.recursiveDelete(document.ref);
        count += 1;
      }
    }

    return count;
  }

  async function deleteAccount(uid) {
    if (typeof uid !== "string" || !uid.trim()) {
      throw new Error("An authenticated user ID is required.");
    }

    // Keep the profile document until Auth deletion for retriable cleanup.
    const profile = db.collection("users").doc(uid);
    const deletedSessions = await removeSessions(uid);
    const subcollections = await profile.listCollections();

    for (const collection of subcollections) {
      await db.recursiveDelete(collection);
    }

    // Never delete the authentication identity if preliminary cleanup fails.
    await authClient.deleteUser(uid);

    // Firebase Auth and Firestore are not a single atomic transaction.
    try {
      await db.recursiveDelete(profile);
    } catch (cause) {
      const error = new Error(
        "The login was deleted, but final profile cleanup failed. Contact an administrator."
      );
      error.code = "account-deletion-partial";
      error.cause = cause;
      throw error;
    }

    return { deleted: true, deletedSessions };
  }

  return { deleteAccount };
}

module.exports = { createAccountDeletionService };
