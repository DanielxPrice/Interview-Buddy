const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();

const { shouldInvalidateMetadata } = require("./relevantMetadata");

exports.invalidateQuestionMetadata = onDocumentWritten(
  { document: "questions/{questionId}", region: "us-west1", minInstances: 0 },
  async (event) => {
    const before = event.data?.before?.exists ? event.data.before.data() : null;
    const after = event.data?.after?.exists ? event.data.after.data() : null;
    if (!shouldInvalidateMetadata(before, after)) return;
    // At-least-once delivery may increment more than once. This revision is
    // intentionally an invalidation token, not an exact count of edits.
    await getFirestore().doc("metadata/questionCatalog").set({
      version: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
);

