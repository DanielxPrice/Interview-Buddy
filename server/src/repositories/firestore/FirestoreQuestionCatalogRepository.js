/** A single shared Firestore revision, read using the Admin SDK. */
class FirestoreQuestionCatalogRepository {
  constructor({ db }) {
    if (!db) throw new Error("FirestoreQuestionCatalogRepository requires db.");
    this.db = db;
  }
  async getRevision() {
    const snapshot = await this.db.collection("metadata").doc("questionCatalog").get();
    const version = snapshot.exists ? snapshot.data()?.version : 0;
    return Number.isSafeInteger(version) && version >= 0 ? version : 0;
  }
}
module.exports = FirestoreQuestionCatalogRepository;
