/**
 * Repository composition root.
 *
 * This is the one application-level location where concrete persistence
 * adapters are selected. Routes receive repository interfaces and never import
 * firebaseAdmin directly.
 */
const { admin, db } = require("../firebaseAdmin");
const FirestoreQuestionRepository = require("./firestore/FirestoreQuestionRepository");
const FirestoreEvaluationRepository = require("./firestore/FirestoreEvaluationRepository");
const FirestoreUserRepository = require("./firestore/FirestoreUserRepository");
const FirestoreSessionRepository = require(
  "./firestore/FirestoreSessionRepository"
);

const sessionRepository = new FirestoreSessionRepository({
  db,
  admin,
});
const questionRepository = new FirestoreQuestionRepository({ db, admin });
const evaluationRepository = new FirestoreEvaluationRepository({ db, admin });
const userRepository = new FirestoreUserRepository({ db, admin });

module.exports = {
  questionRepository,
  evaluationRepository,
  userRepository,
  sessionRepository,
};
