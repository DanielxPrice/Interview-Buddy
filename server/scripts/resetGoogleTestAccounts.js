require("dotenv").config();

const {
  admin,
  db,
} = require("../src/firebaseAdmin");

const TEST_ACCOUNTS = [
  {
    uid: "cswLz08cSLRGIaa4IYBZcWHJKtT2",
    email: "dlphoenixburner@gmail.com",
  },
  {
    uid: "d9a8Zssb0cgMfMnk0Yju3JU0yxZ2",
    email: "danielprice1642@gmail.com",
  },
];

async function inspectAccount({
  uid,
  email,
}) {
  let authUser = null;
  let firestoreUser = null;

  try {
    authUser =
      await admin
        .auth()
        .getUser(uid);
  } catch (error) {
    if (
      error.code !==
      "auth/user-not-found"
    ) {
      throw error;
    }
  }

  const userRef =
    db
      .collection("users")
      .doc(uid);

  const snapshot =
    await userRef.get();

  if (snapshot.exists) {
    firestoreUser =
      snapshot.data();
  }

  if (
    authUser?.email &&
    authUser.email !== email
  ) {
    throw new Error(
      [
        `Safety check failed for UID ${uid}.`,
        `Expected Auth email: ${email}`,
        `Actual Auth email: ${authUser.email}`,
      ].join("\n")
    );
  }

  if (
    firestoreUser?.email &&
    firestoreUser.email !== email
  ) {
    throw new Error(
      [
        `Safety check failed for Firestore user ${uid}.`,
        `Expected Firestore email: ${email}`,
        `Actual Firestore email: ${firestoreUser.email}`,
      ].join("\n")
    );
  }

  return {
    uid,
    email,
    authUser,
    firestoreUser,
    userRef,
  };
}

async function deleteFirestoreUser(
  userRef
) {
  /*
   * recursiveDelete removes the user document
   * plus any subcollections that may exist beneath it,
   * such as future usage/history test data.
   */
  await db.recursiveDelete(
    userRef
  );
}

async function deleteAuthUser(
  uid
) {
  try {
    await admin
      .auth()
      .deleteUser(uid);

    return true;
  } catch (error) {
    if (
      error.code ===
      "auth/user-not-found"
    ) {
      return false;
    }

    throw error;
  }
}

async function main() {
  const confirmed =
    process.argv.includes(
      "--confirm"
    );

  console.log(
    confirmed
      ? "\nRESET MODE: These test accounts will be deleted.\n"
      : "\nDRY RUN: Nothing will be deleted.\n"
  );

  console.log(
    "Accounts targeted:"
  );

  console.log(
    "------------------------------"
  );

  const accounts = [];

  for (
    const account of
    TEST_ACCOUNTS
  ) {
    const inspected =
      await inspectAccount(
        account
      );

    accounts.push(
      inspected
    );

    console.log(
      [
        inspected.email,
        `UID=${inspected.uid}`,
        `Auth=${
          inspected.authUser
            ? "FOUND"
            : "MISSING"
        }`,
        `Firestore=${
          inspected.firestoreUser
            ? "FOUND"
            : "MISSING"
        }`,
      ].join(" | ")
    );
  }

  if (!confirmed) {
    console.log(
      "\nNo changes were made."
    );

    console.log(
      "\nRun this command to actually delete the accounts:"
    );

    console.log(
      "npm run reset-google-test-accounts -- --confirm"
    );

    return;
  }

  console.log(
    "\nDeleting accounts..."
  );

  console.log(
    "------------------------------"
  );

  for (
    const account of
    accounts
  ) {
    const {
      uid,
      email,
      authUser,
      firestoreUser,
      userRef,
    } = account;

    /*
     * Remove Firestore data first so we do not
     * leave an old profile behind if the Auth
     * user gets recreated with a new UID later.
     */
    if (firestoreUser) {
      await deleteFirestoreUser(
        userRef
      );

      console.log(
        `Deleted Firestore profile: ${email}`
      );
    } else {
      console.log(
        `Firestore profile already missing: ${email}`
      );
    }

    if (authUser) {
      await deleteAuthUser(
        uid
      );

      console.log(
        `Deleted Firebase Auth user: ${email}`
      );
    } else {
      console.log(
        `Firebase Auth user already missing: ${email}`
      );
    }

    console.log(
      `RESET COMPLETE | ${email} | UID=${uid}`
    );
  }

  console.log(
    "\nGoogle test-account reset complete."
  );

  console.log(
    "The Google accounts can now be used again as new Interview Buddy signups."
  );
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(
      "\nTest-account reset failed:"
    );

    console.error(
      error.message ||
        error
    );

    process.exit(1);
  });