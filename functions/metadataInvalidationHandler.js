"use strict";

const { shouldInvalidateMetadata } = require("./relevantMetadata");

/**
 * Firestore v2 background event handler. No HTTP request/response or end-user
 * authentication exists at this trigger boundary. Service-account IAM governs
 * the Admin SDK write; direct web clients remain subject to firestore.rules.
 *
 * Dependencies are supplied by the deployed function or by local tests.
 * Propagate failed Firestore writes so the platform can report the failure.
 */
async function processMetadataInvalidationEvent(event, { getDb, FieldValue }) {
  const before = event?.data?.before?.exists ? event.data.before.data() : null;
  const after = event?.data?.after?.exists ? event.data.after.data() : null;
  if (!shouldInvalidateMetadata(before, after)) return false;

  await getDb().doc("metadata/questionCatalog").set({
    version: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return true;
}

module.exports = { processMetadataInvalidationEvent };
