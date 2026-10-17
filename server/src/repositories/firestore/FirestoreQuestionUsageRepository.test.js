const FirestoreQuestionUsageRepository =
  require(
    "./FirestoreQuestionUsageRepository"
  );

describe(
  "FirestoreQuestionUsageRepository",
  () => {
    let usageData;
    let reservationData;

    let usageReference;
    let reservationReference;

    let transaction;
    let db;
    let admin;
    let repository;

    beforeEach(() => {
      usageData = null;
      reservationData = null;

      usageReference = {
        type: "usage",

        get:
          jest.fn(
            async () => ({
              exists:
                usageData !== null,

              data:
                () =>
                  usageData,
            })
          ),
      };

      reservationReference = {
        type: "reservation",

        get:
          jest.fn(
            async () => ({
              exists:
                reservationData !==
                null,

              data:
                () =>
                  reservationData,
            })
          ),
      };

      const usageCollection = {
        doc:
          jest.fn(
            () =>
              usageReference
          ),
      };

      const reservationCollection = {
        doc:
          jest.fn(
            () =>
              reservationReference
          ),
      };

      const userDocument = {
        collection:
          jest.fn(
            (name) => {
              if (
                name === "usage"
              ) {
                return usageCollection;
              }

              if (
                name ===
                "questionReservations"
              ) {
                return reservationCollection;
              }

              throw new Error(
                `Unexpected collection: ${name}`
              );
            }
          ),
      };

      const usersCollection = {
        doc:
          jest.fn(
            () =>
              userDocument
          ),
      };

      transaction = {
        get:
          jest.fn(
            async (
              reference
            ) => {
              if (
                reference ===
                usageReference
              ) {
                return {
                  exists:
                    usageData !==
                    null,

                  data:
                    () =>
                      usageData,
                };
              }

              if (
                reference ===
                reservationReference
              ) {
                return {
                  exists:
                    reservationData !==
                    null,

                  data:
                    () =>
                      reservationData,
                };
              }

              throw new Error(
                "Unexpected Firestore reference."
              );
            }
          ),

        set:
          jest.fn(
            (
              reference,
              data
            ) => {
              if (
                reference ===
                usageReference
              ) {
                usageData = {
                  ...(usageData ||
                    {}),

                  ...data,
                };

                return;
              }

              if (
                reference ===
                reservationReference
              ) {
                reservationData = {
                  ...(reservationData ||
                    {}),

                  ...data,
                };

                return;
              }

              throw new Error(
                "Unexpected Firestore reference."
              );
            }
          ),
      };

      db = {
        collection:
          jest.fn(
            () =>
              usersCollection
          ),

        runTransaction:
          jest.fn(
            async (
              callback
            ) =>
              callback(
                transaction
              )
          ),
      };

      admin = {
        firestore: {
          FieldValue: {
            serverTimestamp:
              jest.fn(
                () =>
                  "server-time"
              ),
          },
        },
      };

      repository =
        new FirestoreQuestionUsageRepository({
          db,
          admin,
        });
    });

    test(
      "returns zero when no daily usage exists",
      async () => {
        const result =
          await repository
            .getDailyUsage({
              uid:
                "user-1",

              dateKey:
                "2026-10-09",
            });

        expect(
          result
        ).toEqual({
          dateKey:
            "2026-10-09",

          aiQuestionsUsed:
            0,

          codeQuestionsUsed:
            0,

          theoreticalQuestionsUsed:
            0,
        });
      }
    );

    test(
      "reserves Code questions and creates an idempotency reservation",
      async () => {
        const result =
          await repository
            .reserveQuestions({
              uid:
                "user-1",

              dateKey:
                "2026-10-09",

              mode:
                "Code Style",

              count: 6,

              limit: 20,

              timeZone:
                "America/Los_Angeles",

              reservationId:
                "session-code",

              reservationFingerprint:
                "fingerprint-code",
            });

        expect(
          result
            .aiQuestionsUsed
        ).toBe(6);

        expect(
          result
            .codeQuestionsUsed
        ).toBe(6);

        expect(
          result
            .theoreticalQuestionsUsed
        ).toBe(0);

        expect(
          result.remaining
        ).toBe(14);

        expect(
          result
            .duplicateReservation
        ).toBe(false);

        expect(
          usageData
            .aiQuestionsUsed
        ).toBe(6);

        expect(
          reservationData
        ).toMatchObject({
          reservationId:
            "session-code",

          fingerprint:
            "fingerprint-code",

          mode:
            "Code Style",

          count: 6,

          dateKey:
            "2026-10-09",
        });
      }
    );

    test(
      "Code and Theoretical share one total",
      async () => {
        usageData = {
          aiQuestionsUsed:
            6,

          codeQuestionsUsed:
            6,

          theoreticalQuestionsUsed:
            0,
        };

        const result =
          await repository
            .reserveQuestions({
              uid:
                "user-1",

              dateKey:
                "2026-10-09",

              mode:
                "Theoretical Style",

              count: 5,

              limit: 20,

              timeZone:
                "America/Los_Angeles",

              reservationId:
                "session-theory",

              reservationFingerprint:
                "fingerprint-theory",
            });

        expect(
          result
            .aiQuestionsUsed
        ).toBe(11);

        expect(
          result
            .codeQuestionsUsed
        ).toBe(6);

        expect(
          result
            .theoreticalQuestionsUsed
        ).toBe(5);

        expect(
          result.remaining
        ).toBe(9);
      }
    );

    test(
      "rejects a new reservation above the daily limit",
      async () => {
        usageData = {
          aiQuestionsUsed:
            18,

          codeQuestionsUsed:
            10,

          theoreticalQuestionsUsed:
            8,
        };

        await expect(
          repository
            .reserveQuestions({
              uid:
                "user-1",

              dateKey:
                "2026-10-09",

              mode:
                "Code Style",

              count: 3,

              limit: 20,

              timeZone:
                "America/Los_Angeles",

              reservationId:
                "session-over-limit",

              reservationFingerprint:
                "fingerprint-over-limit",
            })
        ).rejects
          .toMatchObject({
            code:
              "daily-question-limit-exceeded",

            statusCode:
              429,

            used: 18,

            requested: 3,

            limit: 20,

            remaining: 2,
          });

        expect(
          transaction.set
        ).not.toHaveBeenCalled();
      }
    );

    test(
      "does not count the same session reservation twice",
      async () => {
        /*
         * Simulate the first request
         * having already succeeded.
         */
        usageData = {
          aiQuestionsUsed:
            5,

          codeQuestionsUsed:
            5,

          theoreticalQuestionsUsed:
            0,
        };

        reservationData = {
          reservationId:
            "session-1",

          fingerprint:
            "fingerprint-1",

          mode:
            "Code Style",

          count: 5,

          dateKey:
            "2026-10-09",
        };

        const result =
          await repository
            .reserveQuestions({
              uid:
                "user-1",

              dateKey:
                "2026-10-09",

              mode:
                "Code Style",

              count: 5,

              limit: 20,

              timeZone:
                "America/Los_Angeles",

              reservationId:
                "session-1",

              reservationFingerprint:
                "fingerprint-1",
            });

        expect(
          result
            .aiQuestionsUsed
        ).toBe(5);

        expect(
          result
            .codeQuestionsUsed
        ).toBe(5);

        expect(
          result.remaining
        ).toBe(15);

        expect(
          result
            .duplicateReservation
        ).toBe(true);

        /*
         * Absolutely no writes should
         * happen on the duplicate request.
         */
        expect(
          transaction.set
        ).not.toHaveBeenCalled();
      }
    );

    test(
      "rejects reuse of a session ID with different reservation settings",
      async () => {
        usageData = {
          aiQuestionsUsed:
            5,

          codeQuestionsUsed:
            5,

          theoreticalQuestionsUsed:
            0,
        };

        reservationData = {
          reservationId:
            "session-1",

          fingerprint:
            "original-fingerprint",

          mode:
            "Code Style",

          count: 5,
        };

        await expect(
          repository
            .reserveQuestions({
              uid:
                "user-1",

              dateKey:
                "2026-10-09",

              mode:
                "Code Style",

              count: 5,

              limit: 20,

              timeZone:
                "America/Los_Angeles",

              reservationId:
                "session-1",

              reservationFingerprint:
                "different-fingerprint",
            })
        ).rejects
          .toMatchObject({
            code:
              "question-reservation-conflict",

            statusCode:
              409,

            reservationId:
              "session-1",
          });

        expect(
          transaction.set
        ).not.toHaveBeenCalled();
      }
    );
  }
);