const QuestionUsageRepository =
  require("../contracts/QuestionUsageRepository");

function createLimitExceededError({
  used,
  requested,
  limit,
}) {
  const remaining =
    Math.max(
      limit - used,
      0
    );

  const error = new Error(
    `Daily AI question limit exceeded. ${remaining} questions remain today.`
  );

  error.code =
    "daily-question-limit-exceeded";

  error.statusCode = 429;
  error.used = used;
  error.requested = requested;
  error.limit = limit;
  error.remaining = remaining;

  return error;
}

function createReservationConflictError({
  reservationId,
}) {
  const error = new Error(
    "This interview session was already used with different question settings. Start a new interview session and try again."
  );

  error.code =
    "question-reservation-conflict";

  error.statusCode = 409;

  error.reservationId =
    reservationId;

  return error;
}

class FirestoreQuestionUsageRepository
  extends QuestionUsageRepository {
  constructor({
    db,
    admin,
  }) {
    super();

    if (!db) {
      throw new Error(
        "FirestoreQuestionUsageRepository requires a Firestore db instance."
      );
    }

    this.db = db;
    this.admin = admin;
  }

  getTimestamp() {
    return this.admin
      ?.firestore
      ?.FieldValue
      ?.serverTimestamp
      ? this.admin.firestore
          .FieldValue
          .serverTimestamp()
      : new Date()
          .toISOString();
  }

  getUserReference(uid) {
    return this.db
      .collection("users")
      .doc(uid);
  }

  getUsageReference(
    uid,
    dateKey
  ) {
    return this
      .getUserReference(uid)
      .collection("usage")
      .doc(dateKey);
  }

  /*
   * Reservations are intentionally stored
   * separately from the daily usage document.
   *
   * This lets the same session remain
   * idempotent even if a duplicate request
   * happens around the daily reset boundary.
   */
  getReservationReference(
    uid,
    reservationId
  ) {
    return this
      .getUserReference(uid)
      .collection(
        "questionReservations"
      )
      .doc(reservationId);
  }

  async getDailyUsage({
    uid,
    dateKey,
  }) {
    const reference =
      this.getUsageReference(
        uid,
        dateKey
      );

    const snapshot =
      await reference.get();

    if (!snapshot.exists) {
      return {
        dateKey,

        aiQuestionsUsed: 0,

        codeQuestionsUsed: 0,

        theoreticalQuestionsUsed:
          0,
      };
    }

    const data =
      snapshot.data() || {};

    return {
      dateKey,

      aiQuestionsUsed:
        Number(
          data.aiQuestionsUsed ||
            0
        ),

      codeQuestionsUsed:
        Number(
          data.codeQuestionsUsed ||
            0
        ),

      theoreticalQuestionsUsed:
        Number(
          data
            .theoreticalQuestionsUsed ||
            0
        ),
    };
  }

  async reserveQuestions({
    uid,
    dateKey,
    mode,
    count,
    limit,
    timeZone,
    reservationId,
    reservationFingerprint,
  }) {
    if (!reservationId) {
      throw new Error(
        "FirestoreQuestionUsageRepository.reserveQuestions requires reservationId."
      );
    }

    if (
      !reservationFingerprint
    ) {
      throw new Error(
        "FirestoreQuestionUsageRepository.reserveQuestions requires reservationFingerprint."
      );
    }

    const usageReference =
      this.getUsageReference(
        uid,
        dateKey
      );

    const reservationReference =
      this.getReservationReference(
        uid,
        reservationId
      );

    return this.db
      .runTransaction(
        async (
          transaction
        ) => {
          /*
           * Both documents are read before
           * anything is written.
           *
           * Firestore will retry the
           * transaction if another request
           * modifies either document.
           */
          const usageSnapshot =
            await transaction.get(
              usageReference
            );

          const reservationSnapshot =
            await transaction.get(
              reservationReference
            );

          const usageData =
            usageSnapshot.exists
              ? usageSnapshot.data() ||
                {}
              : {};

          const used =
            Number(
              usageData
                .aiQuestionsUsed ||
                0
            );

          const codeQuestionsUsed =
            Number(
              usageData
                .codeQuestionsUsed ||
                0
            );

          const theoreticalQuestionsUsed =
            Number(
              usageData
                .theoreticalQuestionsUsed ||
                0
            );

          const requested =
            Number(
              count || 0
            );

          /*
           * Same session already reserved.
           *
           * If everything matches, this is
           * simply a duplicate request.
           *
           * Do NOT increment quota again.
           */
          if (
            reservationSnapshot.exists
          ) {
            const reservationData =
              reservationSnapshot.data() ||
              {};

            const sameReservation =
              reservationData
                .fingerprint ===
                reservationFingerprint &&
              reservationData.mode ===
                mode &&
              Number(
                reservationData
                  .count || 0
              ) === requested;

            if (
              !sameReservation
            ) {
              throw createReservationConflictError(
                {
                  reservationId,
                }
              );
            }

            return {
              dateKey,
              timeZone,
              limit,

              aiQuestionsUsed:
                used,

              codeQuestionsUsed,

              theoreticalQuestionsUsed,

              remaining:
                Math.max(
                  limit - used,
                  0
                ),

              reservationId,

              duplicateReservation:
                true,
            };
          }

          /*
           * This is a brand-new session
           * reservation.
           */
          if (
            used + requested >
            limit
          ) {
            throw createLimitExceededError(
              {
                used,
                requested,
                limit,
              }
            );
          }

          const updatedUsage = {
            dateKey,

            timeZone,

            limit,

            aiQuestionsUsed:
              used + requested,

            codeQuestionsUsed:
              mode ===
              "Code Style"
                ? codeQuestionsUsed +
                  requested
                : codeQuestionsUsed,

            theoreticalQuestionsUsed:
              mode ===
              "Theoretical Style"
                ? theoreticalQuestionsUsed +
                  requested
                : theoreticalQuestionsUsed,

            updatedAt:
              this.getTimestamp(),
          };

          if (
            !usageSnapshot.exists
          ) {
            updatedUsage.createdAt =
              this.getTimestamp();
          }

          transaction.set(
            usageReference,
            updatedUsage,
            {
              merge: true,
            }
          );

          /*
           * This document is the idempotency
           * record for this interview session.
           */
          transaction.set(
            reservationReference,
            {
              reservationId,

              fingerprint:
                reservationFingerprint,

              mode,

              count:
                requested,

              dateKey,

              timeZone,

              createdAt:
                this.getTimestamp(),
            }
          );

          return {
            ...updatedUsage,

            remaining:
              Math.max(
                limit -
                  updatedUsage
                    .aiQuestionsUsed,
                0
              ),

            reservationId,

            duplicateReservation:
              false,
          };
        }
      );
  }
}

module.exports =
  FirestoreQuestionUsageRepository;

module.exports
  .createLimitExceededError =
  createLimitExceededError;

module.exports
  .createReservationConflictError =
  createReservationConflictError;