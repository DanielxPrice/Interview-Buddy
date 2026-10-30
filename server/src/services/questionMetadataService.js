const { MODES, buildQuestionMetadata } = require("./questionMetadataBuilder");

/** Per Cloud Run instance cache. Firestore revision is the shared invalidation signal. */
function createQuestionMetadataService({ questionRepository, catalogRepository, now = Date.now }) {
  if (!questionRepository || !catalogRepository) {
    throw new Error("Metadata service requires question and catalog repositories.");
  }
  let cachedRevision = null;
  let cachedMetadata = null;
  let revisionCache = null;
  let nextRevisionCheck = 0;
  let pendingVersion = null;
  let pendingBuild = null;
  const REVISION_CHECK_MS = 10000;

  async function getVersion() {
    if (revisionCache !== null && now() < nextRevisionCheck) return revisionCache;
    if (!pendingVersion) {
      pendingVersion = catalogRepository.getRevision()
        .then((version) => {
          revisionCache = version;
          nextRevisionCheck = now() + REVISION_CHECK_MS;
          return version;
        })
        .finally(() => { pendingVersion = null; });
    }
    return pendingVersion;
  }

  async function getMetadata() {
    const version = await getVersion();
    if (cachedMetadata && cachedRevision === version) {
      return { version, ...cachedMetadata };
    }
    if (!pendingBuild) {
      pendingBuild = (async () => {
        const revisionAtStart = version;
        const questionGroups = await Promise.all(MODES.map(
          (mode) => typeof questionRepository.findByModeMetadata === "function"
            ? questionRepository.findByModeMetadata(mode)
            : questionRepository.findByMode(mode)
        ));
        const metadata = buildQuestionMetadata(questionGroups.flat());
        // Re-check Firestore after rebuilding to catch writes during the scan.
        const latestRevision = await catalogRepository.getRevision();
        if (latestRevision !== revisionAtStart) {
          revisionCache = latestRevision;
          nextRevisionCheck = now() + REVISION_CHECK_MS;
          // Do not mark an outdated scan as current.
          throw Object.assign(new Error("Catalog updated during metadata rebuild; retry."),
            { code: "metadata-changed-during-build" });
        }
        cachedMetadata = metadata;
        cachedRevision = latestRevision;
        return { version: latestRevision, ...metadata };
      })().finally(() => { pendingBuild = null; });
    }
    return pendingBuild;
  }

  return { getVersion, getMetadata };
}

module.exports = { createQuestionMetadataService };
