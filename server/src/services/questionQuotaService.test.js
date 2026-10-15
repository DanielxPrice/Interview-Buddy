const {
  getDateKey,
  createQuestionQuotaService,
} = require(
  "./questionQuotaService"
);

describe(
  "questionQuotaService",
  () => {
    test(
      "creates date keys in the configured time zone",
      () => {
        const instant =
          new Date(
            "2026-10-10T06:30:00.000Z"
          );

        expect(
          getDateKey(
            instant,
            "America/Los_Angeles"
          )
        ).toBe(
          "2026-10-09"
        );

        expect(
          getDateKey(
            instant,
            "UTC"
          )
        ).toBe(
          "2026-10-10"
        );
      }
    );

    test(
      "Code and Theoretical share the same daily allowance",
      async () => {
        let used = 0;

        const usageRepository = {
          getDailyUsage:
            jest.fn(
              async () => ({
                aiQuestionsUsed:
                  used,

                codeQuestionsUsed:
                  0,

                theoreticalQuestionsUsed:
                  0,
              })
            ),

          reserveQuestions:
            jest.fn(
              async ({
                count,
                limit,
              }) => {
                used += count;

                return {
                  aiQuestionsUsed:
                    used,

                  codeQuestionsUsed:
                    used,

                  theoreticalQuestionsUsed:
                    0,

                  remaining:
                    limit - used,

                  duplicateReservation:
                    false,
                };
              }
            ),
        };

        const service =
          createQuestionQuotaService({
            usageRepository,

            dailyLimit: 20,

            timeZone:
              "America/Los_Angeles",

            now: () =>
              new Date(
                "2026-10-09T20:00:00-07:00"
              ),
          });

        const code =
          await service.consume({
            uid:
              "user-1",

            role:
              "user",

            mode:
              "Code Style",

            count: 6,

            reservationId:
              "session-code",

            reservationFingerprint:
              "fingerprint-code",
          });

        const theoretical =
          await service.consume({
            uid:
              "user-1",

            role:
              "user",

            mode:
              "Theoretical Style",

            count: 4,

            reservationId:
              "session-theoretical",

            reservationFingerprint:
              "fingerprint-theoretical",
          });

        expect(
          code.used
        ).toBe(6);

        expect(
          theoretical.used
        ).toBe(10);

        expect(
          theoretical.remaining
        ).toBe(10);

        expect(
          usageRepository
            .reserveQuestions
        ).toHaveBeenCalledTimes(
          2
        );

        expect(
          usageRepository
            .reserveQuestions
        ).toHaveBeenNthCalledWith(
          1,
          expect.objectContaining({
            uid:
              "user-1",

            mode:
              "Code Style",

            count: 6,

            reservationId:
              "session-code",

            reservationFingerprint:
              "fingerprint-code",
          })
        );

        expect(
          usageRepository
            .reserveQuestions
        ).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({
            uid:
              "user-1",

            mode:
              "Theoretical Style",

            count: 4,

            reservationId:
              "session-theoretical",

            reservationFingerprint:
              "fingerprint-theoretical",
          })
        );
      }
    );

    test(
      "Quiz Style does not consume the allowance",
      async () => {
        const usageRepository = {
          getDailyUsage:
            jest.fn()
              .mockResolvedValue({
                aiQuestionsUsed:
                  7,

                codeQuestionsUsed:
                  4,

                theoreticalQuestionsUsed:
                  3,
              }),

          reserveQuestions:
            jest.fn(),
        };

        const service =
          createQuestionQuotaService({
            usageRepository,

            dailyLimit: 20,

            timeZone:
              "America/Los_Angeles",
          });

        const result =
          await service.consume({
            uid:
              "user-1",

            role:
              "user",

            mode:
              "Quiz Style",

            count: 10,
          });

        expect(
          usageRepository
            .reserveQuestions
        ).not.toHaveBeenCalled();

        expect(
          result.used
        ).toBe(7);

        expect(
          result.remaining
        ).toBe(13);
      }
    );

    test(
      "admins bypass the normal limit without creating a reservation",
      async () => {
        const usageRepository = {
          getDailyUsage:
            jest.fn(),

          reserveQuestions:
            jest.fn(),
        };

        const service =
          createQuestionQuotaService({
            usageRepository,

            dailyLimit: 20,
          });

        const result =
          await service.consume({
            uid:
              "admin-1",

            role:
              "admin",

            mode:
              "Code Style",

            count: 20,
          });

        expect(
          result.unlimited
        ).toBe(true);

        expect(
          result.limit
        ).toBeNull();

        expect(
          result.remaining
        ).toBeNull();

        expect(
          usageRepository
            .reserveQuestions
        ).not.toHaveBeenCalled();
      }
    );

    test(
      "forwards reservation information to the repository",
      async () => {
        const usageRepository = {
          getDailyUsage:
            jest.fn(),

          reserveQuestions:
            jest.fn()
              .mockResolvedValue({
                aiQuestionsUsed:
                  5,

                codeQuestionsUsed:
                  5,

                theoreticalQuestionsUsed:
                  0,

                remaining: 15,

                duplicateReservation:
                  false,
              }),
        };

        const service =
          createQuestionQuotaService({
            usageRepository,

            dailyLimit: 20,

            timeZone:
              "America/Los_Angeles",

            now: () =>
              new Date(
                "2026-10-09T20:00:00-07:00"
              ),
          });

        const result =
          await service.consume({
            uid:
              "user-1",

            role:
              "user",

            mode:
              "Code Style",

            count: 5,

            reservationId:
              "session-1",

            reservationFingerprint:
              "fingerprint-1",
          });

        expect(
          usageRepository
            .reserveQuestions
        ).toHaveBeenCalledWith({
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
          result.used
        ).toBe(5);

        expect(
          result.remaining
        ).toBe(15);

        expect(
          result.reservationId
        ).toBe(
          "session-1"
        );

        expect(
          result
            .duplicateReservation
        ).toBe(false);
      }
    );
  }
);