const QuestionRepository = require("../contracts/QuestionRepository");
const { randomUUID } = require("node:crypto");
const { FieldValue } = require("firebase-admin/firestore");

/**
 * Firestore implementation of the question data-access contract.
 *
 * Firestore collection/query/document APIs are deliberately contained in this
 * adapter so Express routes do not depend on Firebase-specific behavior.
 */
class FirestoreQuestionRepository extends QuestionRepository {
  constructor({ db, admin }) {
    super();

    if (!db) {
      throw new Error("FirestoreQuestionRepository requires a Firestore db instance.");
    }

    this.db = db;
    this.admin = admin;
  }

  async findByMode(mode) {
    const snapshot = await this.db
      .collection("questions")
      .where("mode", "==", mode)
      .get();

    return snapshot.docs.map((document) => ({
      id: document.id,
      ...document.data(),
    }));
  }

  async findById(questionId) {
    const document = await this.db.collection("questions").doc(questionId).get();

    if (!document.exists) {
      return null;
    }

    return {
      id: document.id,
      ...document.data(),
    };
  }

  /**
   * Used by the seed utility so Firestore-specific batch/write behavior also
   * stays inside the data-access layer.
   */
  async upsertMany(questions) {
    if (!Array.isArray(questions) || questions.length === 0) {
      return 0;
    }

    // Firestore batched writes have a finite operation limit. The expanded
    // Interview Buddy seed contains 1,500 questions, so writing the entire
    // seed in one batch would fail. Keep each commit comfortably below the
    // platform limit and continue until every question has been upserted.
    const batchSize = 400;
    // One operation ID per import distinguishes seed writes from manual edits.
    // The Firestore trigger skips the version update for writes with a NEW ID,
    // since each question batch updates the catalog atomically below.
    const metadataSeedBatchId = randomUUID();
    const catalogRef = this.db.collection("metadata").doc("questionCatalog");

    for (let start = 0; start < questions.length; start += batchSize) {
      const batch = this.db.batch();
      const chunk = questions.slice(start, start + batchSize);

      for (const question of chunk) {
        const { id, ...data } = question;
        const reference = this.db.collection("questions").doc(id);

        const updatedAt = this.admin?.firestore?.FieldValue?.serverTimestamp
          ? this.admin.firestore.FieldValue.serverTimestamp()
          : new Date().toISOString();

        batch.set(
          reference,
          {
            ...data,
            _metadataSeedBatchId: metadataSeedBatchId,
            updatedAt,
          },
          { merge: true }
        );
      }

      // Exactly one revision bump per committed batch, rather than one for
      // each question-trigger event. Questions and revision commit together.
      batch.set(
        catalogRef,
        {
          version: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      await batch.commit();
    }

    return questions.length;
  }
}

module.exports = FirestoreQuestionRepository;
