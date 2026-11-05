const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { processMetadataInvalidationEvent } = require("./metadataInvalidationHandler");

initializeApp();

exports.invalidateQuestionMetadata = onDocumentWritten(
  { document: "questions/{questionId}", region: "us-west1", minInstances: 0 },
  (event) => processMetadataInvalidationEvent(event, { getDb: getFirestore, FieldValue })
);

// Auth lifecycle events use first-generation triggers alongside the v2 trigger.
// Retry failures so a temporary Firestore outage cannot strand a profile.
const functionsV1 = require("firebase-functions/v1");
const { cleanupDeletedAccount } = require("./accountCleanup");
exports.cleanupDeletedAccount = functionsV1
  .region("us-west1")
  .runWith({ failurePolicy: true })
  .auth.user().onDelete((user) => cleanupDeletedAccount(getFirestore(), user.uid));
