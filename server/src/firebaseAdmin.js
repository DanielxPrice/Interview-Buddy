const admin = require("firebase-admin");

function getCredential() {
  const inlineServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (inlineServiceAccount) {
    try {
      return admin.credential.cert(JSON.parse(inlineServiceAccount));
    } catch (error) {
      throw new Error(
        "FIREBASE_SERVICE_ACCOUNT_JSON is present but is not valid JSON."
      );
    }
  }

  // Uses GOOGLE_APPLICATION_CREDENTIALS locally, or the platform-provided
  // service account when deployed to Google/Firebase infrastructure.
  return admin.credential.applicationDefault();
}

if (!admin.apps.length) {
  const projectId = process.env.FIREBASE_PROJECT_ID;

  if (!projectId) {
    throw new Error(
      "Missing FIREBASE_PROJECT_ID. Copy server/.env.example to server/.env and configure it."
    );
  }

  admin.initializeApp({
    credential: getCredential(),
    projectId,
  });
}

const db = admin.firestore();

db.settings({ ignoreUndefinedProperties: true });

module.exports = { admin, db };
