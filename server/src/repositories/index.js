
/**
 * Repository composition root.
 *
 * This is the one application-level location where concrete persistence
 * adapters are selected. Routes receive repository interfaces and never import
 * firebaseAdmin directly.
 */

const { admin, db } = require("../firebaseAdmin");

const FirestoreQuestionRepository = require(
  "./firestore/FirestoreQuestionRepository"
);

const FirestoreEvaluationRepository = require(
  "./firestore/FirestoreEvaluationRepository"
);

const FirestoreUserRepository = require(
  "./firestore/FirestoreUserRepository"
);

const FirestoreQuestionUsageRepository = require(
  "./firestore/FirestoreQuestionUsageRepository"
);

const FirestoreSessionRepository = require(
  "./firestore/FirestoreSessionRepository"
);

const FirestoreQuestionCatalogRepository = require(
  "./firestore/FirestoreQuestionCatalogRepository"
);

// Question metadata/catalog repository.
const questionCatalogRepository =
  new FirestoreQuestionCatalogRepository({
    db,
  });

// Interview question repository.
const questionRepository =
  new FirestoreQuestionRepository({
    db,
    admin,
  });

// AI evaluation repository.
const evaluationRepository =
  new FirestoreEvaluationRepository({
    db,
    admin,
  });

// User profile repository.
const userRepository =
  new FirestoreUserRepository({
    db,
    admin,
  });

// Daily question usage repository.
const questionUsageRepository =
  new FirestoreQuestionUsageRepository({
    db,
    admin,
  });

// Interview session repository.
const sessionRepository =
  new FirestoreSessionRepository({
    db,
    admin,
  });

const { createAccountDeletionService } = require("../services/accountDeletionService");
const authClient = admin.auth();
const accountDeletionService = createAccountDeletionService({ db, authClient });

// Export repository instances for application services and routes.
module.exports = {
  questionRepository,
  questionCatalogRepository,
  evaluationRepository,
  userRepository,
  questionUsageRepository,
  sessionRepository,
  accountDeletionService,
  authClient,
};
