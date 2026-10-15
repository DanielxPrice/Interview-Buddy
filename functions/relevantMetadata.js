/** Only changes that affect the setup dropdowns invalidate the catalog. */
function relevantMetadata(data) {
  if (!data) return null;
  const clean = (array) => [...new Set((Array.isArray(array) ? array : [])
    .map((value) => String(value || "").trim().toLowerCase()).filter(Boolean))].sort();
  return {
    mode: data.mode || "",
    active: data.active !== false,
    jobRoles: clean(data.jobRoles),
    experienceLevels: clean(data.experienceLevels),
    tags: clean(data.tags),
  };
}


/**
 * Bulk seed writes already increment the shared catalog in the same batch.
 * Skip the triggered increment only when the seed operation ID is new.
 * Console edits to previously seeded questions retain the ID, so they still
 * invalidate metadata when relevant fields change.
 */
function shouldInvalidateMetadata(before, after) {
  if (JSON.stringify(relevantMetadata(before)) === JSON.stringify(relevantMetadata(after))) {
    return false;
  }
  const newSeedOperation = Boolean(
    after &&
    typeof after._metadataSeedBatchId === "string" &&
    after._metadataSeedBatchId.length > 0 &&
    (!before || before._metadataSeedBatchId !== after._metadataSeedBatchId)
  );
  return !newSeedOperation;
}

module.exports = { relevantMetadata, shouldInvalidateMetadata };
