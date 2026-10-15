const {
  USER_ROLES,
} = require(
  "../config/roles"
);

const {
  USER_DAILY_QUESTION_LIMIT,
  DAILY_QUESTION_QUOTA_TIME_ZONE,
} = require(
  "../config/questionQuota"
);

const COUNTED_MODES =
  new Set([
    "Code Style",
    "Theoretical Style",
  ]);

function getDateKey(
  date,
  timeZone
) {
  const formatter =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone,

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit",
      }
    );

  const parts =
    formatter
      .formatToParts(
        date
      );

  const values =
    Object.fromEntries(
      parts
        .filter(
          (part) =>
            part.type !==
            "literal"
        )
        .map(
          (part) => [
            part.type,
            part.value,
          ]
        )
    );

  return [
    values.year,
    values.month,
    values.day,
  ].join("-");
}

function createQuestionQuotaService({
  usageRepository,

  dailyLimit =
    USER_DAILY_QUESTION_LIMIT,

  timeZone =
    DAILY_QUESTION_QUOTA_TIME_ZONE,

  now = () =>
    new Date(),
}) {
  if (!usageRepository) {
    throw new Error(
      "createQuestionQuotaService requires usageRepository."
    );
  }

  function buildUnlimitedStatus(
    role
  ) {
    return {
      role,

      unlimited: true,

      limit: null,

      used: 0,

      remaining: null,

      dateKey:
        getDateKey(
          now(),
          timeZone
        ),

      timeZone,
    };
  }

  async function getStatus({
    uid,
    role,
  }) {
    if (
      role ===
      USER_ROLES.ADMIN
    ) {
      return buildUnlimitedStatus(
        role
      );
    }

    const dateKey =
      getDateKey(
        now(),
        timeZone
      );

    const usage =
      await usageRepository
        .getDailyUsage({
          uid,
          dateKey,
        });

    const used =
      Number(
        usage
          .aiQuestionsUsed ||
          0
      );

    return {
      role,

      unlimited: false,

      limit:
        dailyLimit,

      used,

      remaining:
        Math.max(
          dailyLimit -
            used,
          0
        ),

      codeQuestionsUsed:
        Number(
          usage
            .codeQuestionsUsed ||
            0
        ),

      theoreticalQuestionsUsed:
        Number(
          usage
            .theoreticalQuestionsUsed ||
            0
        ),

      dateKey,

      timeZone,
    };
  }

  async function consume({
    uid,
    role,
    mode,
    count,
    reservationId,
    reservationFingerprint,
  }) {
    const requested =
      Number(
        count || 0
      );

    /*
     * Quiz Style does not consume
     * daily quota.
     */
    if (
      requested <= 0 ||
      !COUNTED_MODES.has(
        mode
      )
    ) {
      return getStatus({
        uid,
        role,
      });
    }

    /*
     * Admins bypass quota completely.
     */
    if (
      role ===
      USER_ROLES.ADMIN
    ) {
      return buildUnlimitedStatus(
        role
      );
    }

    /*
     * Every counted interview must have
     * a stable session reservation ID.
     */
    if (!reservationId) {
      throw new Error(
        "A reservation ID is required for counted interview questions."
      );
    }

    if (
      !reservationFingerprint
    ) {
      throw new Error(
        "A reservation fingerprint is required for counted interview questions."
      );
    }

    const dateKey =
      getDateKey(
        now(),
        timeZone
      );

    const usage =
      await usageRepository
        .reserveQuestions({
          uid,

          dateKey,

          mode,

          count:
            requested,

          limit:
            dailyLimit,

          timeZone,

          reservationId,

          reservationFingerprint,
        });

    return {
      role,

      unlimited: false,

      limit:
        dailyLimit,

      used:
        Number(
          usage
            .aiQuestionsUsed ||
            0
        ),

      remaining:
        Number(
          usage
            .remaining ||
            0
        ),

      codeQuestionsUsed:
        Number(
          usage
            .codeQuestionsUsed ||
            0
        ),

      theoreticalQuestionsUsed:
        Number(
          usage
            .theoreticalQuestionsUsed ||
            0
        ),

      dateKey,

      timeZone,

      reservationId,

      duplicateReservation:
        Boolean(
          usage
            .duplicateReservation
        ),
    };
  }

  return {
    getStatus,
    consume,
  };
}

module.exports = {
  COUNTED_MODES,
  getDateKey,
  createQuestionQuotaService,
};