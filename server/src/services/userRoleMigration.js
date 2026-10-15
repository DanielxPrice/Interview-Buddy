const {
  DEFAULT_USER_ROLE,
  VALID_USER_ROLES,
} = require("../config/roles");

function getServerTimestamp(admin) {
  return admin?.firestore?.FieldValue?.serverTimestamp
    ? admin.firestore.FieldValue.serverTimestamp()
    : new Date().toISOString();
}

function normalizeStoredRole(role) {
  return String(role || "")
    .trim()
    .toLowerCase();
}

async function backfillUserRoles({
  db,
  admin,
  dryRun = false,
}) {
  if (!db) {
    throw new Error(
      "backfillUserRoles requires a Firestore db instance."
    );
  }

  const snapshot = await db
    .collection("users")
    .get();

  const documents = snapshot.docs || [];

  const summary = {
    usersScanned: documents.length,
    missingRoles: 0,
    invalidRoles: 0,
    validRolesPreserved: 0,
    rolesWritten: 0,
    errors: 0,
  };

  for (const document of documents) {
    const data = document.data() || {};
    const storedRole = normalizeStoredRole(
      data.role
    );

    // Preserve valid existing roles.
    if (VALID_USER_ROLES.has(storedRole)) {
      summary.validRolesPreserved += 1;
      continue;
    }

    // Missing roles and unknown roles become normal users.
    if (!storedRole) {
      summary.missingRoles += 1;
    } else {
      summary.invalidRoles += 1;
    }

    // Dry run lets us inspect what would change first.
    if (dryRun) {
      continue;
    }

    try {
      await document.ref.set(
        {
          role: DEFAULT_USER_ROLE,
          updatedAt:
            getServerTimestamp(admin),
        },
        {
          merge: true,
        }
      );

      summary.rolesWritten += 1;
    } catch (error) {
      summary.errors += 1;

      console.error(
        `Failed to update role for user ${document.id}:`,
        error.message || error
      );
    }
  }

  return summary;
}

module.exports = {
  backfillUserRoles,
};