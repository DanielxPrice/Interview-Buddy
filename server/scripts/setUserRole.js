require("dotenv").config();

const {
  admin,
  db,
} = require("../src/firebaseAdmin");

const {
  VALID_USER_ROLES,
  normalizeUserRole,
} = require("../src/config/roles");

async function main() {
  const [uidArg, roleArg] =
    process.argv.slice(2);

  const uid = String(uidArg || "").trim();

  const requestedRole =
    String(roleArg || "")
      .trim()
      .toLowerCase();

  if (!uid || !requestedRole) {
    throw new Error(
      "Usage: npm run set-role -- <firebase-uid> <user|admin>"
    );
  }

  if (
    !VALID_USER_ROLES.has(
      requestedRole
    )
  ) {
    throw new Error(
      `Invalid role: ${requestedRole}. Allowed roles: ${[
        ...VALID_USER_ROLES,
      ].join(", ")}.`
    );
  }

  const role =
    normalizeUserRole(
      requestedRole
    );

  const userRecord =
    await admin.auth().getUser(uid);

  const existingClaims =
    userRecord.customClaims || {};

  await admin.auth().setCustomUserClaims(
    uid,
    {
      ...existingClaims,
      role,
    }
  );

  await db
    .collection("users")
    .doc(uid)
    .set(
      {
        role,
        updatedAt:
          admin.firestore.FieldValue.serverTimestamp(),
      },
      {
        merge: true,
      }
    );

  console.log(
    `Updated ${uid} to role "${role}" in Firebase Auth and Firestore.`
  );

  console.log(
    "The user must sign in again or refresh their Firebase ID token before the new claim is visible."
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(
      error.message || error
    );

    process.exit(1);
  });