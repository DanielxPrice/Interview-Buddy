const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { processMetadataInvalidationEvent } = require("./metadataInvalidationHandler");

initializeApp();

exports.invalidateQuestionMetadata = onDocumentWritten(
  { document: "questions/{questionId}", region: "us-west1", minInstances: 0 },
  (event) => processMetadataInvalidationEvent(event, { getDb: getFirestore, FieldValue })
);
