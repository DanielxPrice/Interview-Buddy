const {
  DEFAULT_USER_ROLE,
  VALID_USER_ROLES,
} = require("../config/roles");

function normalizeRole(role) {
  const normalized = String(role || "")
    .trim()
    .toLowerCase();

  return VALID_USER_ROLES.has(normalized)
    ? normalized
    : null;
}

function getAuthEmail(user) {
  if (user?.email) {
    return String(user.email).trim();
  }

  const providerEmail = (user?.providerData || [])
    .map((provider) => provider?.email)
    .find(Boolean);

  return String(providerEmail || "").trim();
}

function getUsernameBase(user) {
  const displayName = String(
    user?.displayName || ""
  ).trim();

  if (displayName) {
    return displayName;
  }

  const email = getAuthEmail(user);

  if (email.includes("@")) {
    return email.split("@")[0];
  }

  return `user-${String(user?.uid || "")
    .slice(0, 8)}`;
}

function normalizeUsernameKey(username) {
  return String(username || "")
    .trim()
    .toLowerCase();
}

function createUniqueUsername({
  user,
  reservedUsernames,
}) {
  let base = getUsernameBase(user);

  // Avoid importing an HTML-looking username from an
  // external authentication provider.
  base = base
    .replace(/<[^>]*>/g, "")
    .trim();

  if (!base) {
    base = `user-${String(user.uid).slice(
      0,
      8
    )}`;
  }

  let candidate = base;
  let candidateKey =
    normalizeUsernameKey(candidate);

  if (!reservedUsernames.has(candidateKey)) {
    reservedUsernames.add(candidateKey);
    return candidate;
  }

  const uidSuffix = String(user.uid).slice(
    0,
    6
  );

  candidate = `${base}-${uidSuffix}`;
  candidateKey =
    normalizeUsernameKey(candidate);

  let counter = 2;

  while (reservedUsernames.has(candidateKey)) {
    candidate = `${base}-${uidSuffix}-${counter}`;
    candidateKey =
      normalizeUsernameKey(candidate);

    counter += 1;
  }

  reservedUsernames.add(candidateKey);

  return candidate;
}

function getCreatedAt(user) {
  const creationTime =
    user?.metadata?.creationTime;

  if (!creationTime) {
    return new Date();
  }

  const parsedDate = new Date(creationTime);

  if (Number.isNaN(parsedDate.getTime())) {
    return new Date();
  }

  return parsedDate;
}

function getServerTimestamp(admin) {
  return admin?.firestore?.FieldValue
    ?.serverTimestamp
    ? admin.firestore.FieldValue.serverTimestamp()
    : new Date();
}

async function listAllAuthUsers(auth) {
  const users = [];
  let pageToken;

  do {
    const result = await auth.listUsers(
      1000,
      pageToken
    );

    users.push(...result.users);
    pageToken = result.pageToken;
  } while (pageToken);

  return users;
}

async function syncAuthUsersToFirestore({
  auth,
  db,
  admin,
  dryRun = false,
}) {
  if (!auth) {
    throw new Error(
      "syncAuthUsersToFirestore requires Firebase Auth."
    );
  }

  if (!db) {
    throw new Error(
      "syncAuthUsersToFirestore requires Firestore."
    );
  }

  const authUsers =
    await listAllAuthUsers(auth);

  const firestoreSnapshot = await db
    .collection("users")
    .get();

  const firestoreDocuments = new Map();
  const reservedUsernames = new Set();

  for (const document of firestoreSnapshot.docs) {
    const data = document.data() || {};

    firestoreDocuments.set(
      document.id,
      data
    );

    const username =
      data.usernameLower ||
      normalizeUsernameKey(data.username);

    if (username) {
      reservedUsernames.add(username);
    }
  }

  const summary = {
    authUsersScanned: authUsers.length,
    firestoreProfilesFound:
      firestoreSnapshot.docs.length,
    completeProfiles: 0,
    missingProfiles: 0,
    incompleteProfiles: 0,
    profilesWritten: 0,
    skippedWithoutEmail: 0,
    errors: 0,
  };

  const actions = [];

  for (const user of authUsers) {
    const uid = String(user.uid || "").trim();

    if (!uid) {
      summary.errors += 1;
      continue;
    }

    const existingData =
      firestoreDocuments.get(uid) || null;

    const email = getAuthEmail(user);

    if (!email) {
      summary.skippedWithoutEmail += 1;

      actions.push({
        uid,
        email: "",
        action: "skipped",
        reason:
          "Authentication account has no email address.",
      });

      continue;
    }

    const trustedAuthRole =
      normalizeRole(
        user.customClaims?.role
      ) || DEFAULT_USER_ROLE;

    // ---------------------------------------------------
    // User has no Firestore profile at all.
    // ---------------------------------------------------
    if (!existingData) {
      summary.missingProfiles += 1;

      const username =
        createUniqueUsername({
          user,
          reservedUsernames,
        });

      const profile = {
        uid,
        username,
        usernameLower:
          normalizeUsernameKey(username),
        email,
        role: trustedAuthRole,
        settings: {theme: "light",},
        createdAt: getCreatedAt(user),
        updatedAt:
          getServerTimestamp(admin),
      };

      actions.push({
        uid,
        email,
        username,
        role: trustedAuthRole,
        action: dryRun
          ? "would-create"
          : "created",
      });

      if (!dryRun) {
        try {
          await db
            .collection("users")
            .doc(uid)
            .set(profile, {
              merge: true,
            });

          summary.profilesWritten += 1;
        } catch (error) {
          summary.errors += 1;

          console.error(
            `Failed to create Firestore profile for ${uid}:`,
            error.message || error
          );
        }
      }

      continue;
    }

    // ---------------------------------------------------
    // A Firestore profile exists. Fill only fields that
    // are missing. Do not overwrite existing settings,
    // username, email, role, etc.
    // ---------------------------------------------------
    const updates = {};

    if (!existingData.uid) {
      updates.uid = uid;
    }

    if (!existingData.email) {
      updates.email = email;
    }

    if (
        !existingData.settings ||
        typeof existingData.settings !== "object"
    ) {
        updates.settings = {
            theme: "light",
    };
    } else if (!existingData.settings.theme) {
        updates.settings = {
            ...existingData.settings,
            theme: "light",
    };
    }

    let username =
      String(existingData.username || "")
        .trim();

    if (!username) {
      username =
        createUniqueUsername({
          user,
          reservedUsernames,
        });

      updates.username = username;
      updates.usernameLower =
        normalizeUsernameKey(username);
    } else if (!existingData.usernameLower) {
      updates.usernameLower =
        normalizeUsernameKey(username);
    }

    if (!normalizeRole(existingData.role)) {
      updates.role = trustedAuthRole;
    }

    if (!existingData.createdAt) {
      updates.createdAt =
        getCreatedAt(user);
    }

    const fieldsToUpdate =
      Object.keys(updates);

    if (fieldsToUpdate.length === 0) {
      summary.completeProfiles += 1;

      actions.push({
        uid,
        email,
        action: "unchanged",
        role: existingData.role,
      });

      continue;
    }

    summary.incompleteProfiles += 1;

    updates.updatedAt =
      getServerTimestamp(admin);

    actions.push({
      uid,
      email,
      action: dryRun
        ? "would-repair"
        : "repaired",
      fields: fieldsToUpdate,
      role:
        updates.role ||
        existingData.role ||
        trustedAuthRole,
    });

    if (!dryRun) {
      try {
        await db
          .collection("users")
          .doc(uid)
          .set(updates, {
            merge: true,
          });

        summary.profilesWritten += 1;
      } catch (error) {
        summary.errors += 1;

        console.error(
          `Failed to repair Firestore profile for ${uid}:`,
          error.message || error
        );
      }
    }
  }

  return {
    summary,
    actions,
  };
}

module.exports = {
  syncAuthUsersToFirestore,
  listAllAuthUsers,
  createUniqueUsername,
};