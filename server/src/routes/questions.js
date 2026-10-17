const crypto =
  require("crypto");

const express =
  require("express");

const {
  buildQuestionSetupOptions,
  countEligibleQuestions,
  parseSelectedTags,
  selectQuestions,
} = require(
  "../services/questionSelection"
);

const ALLOWED_MODES =
  new Set([
    "Quiz Style",
    "Code Style",
    "Theoretical Style",
  ]);

const COUNTED_MODES =
  new Set([
    "Code Style",
    "Theoretical Style",
  ]);

const SESSION_ID_PATTERN =
  /^[A-Za-z0-9_-]{1,128}$/;

function normalize(
  value
) {
  return String(
    value || ""
  )
    .trim()
    .toLowerCase();
}

function toPublicQuestion(
  question
) {
  return {
    id:
      question.id,

    mode:
      question.mode,

    prompt:
      question.prompt,

    options:
      Array.isArray(
        question.options
      )
        ? question.options
        : [],

    difficulty:
      question.difficulty ||
      "",

    topic:
      question.topic ||
      "",

    tags:
      Array.isArray(
        question.tags
      )
        ? question.tags
        : [],
  };
}

function quotaErrorResponse(
  error
) {
  return {
    error:
      error.message,

    code:
      error.code,

    quota: {
      limit:
        error.limit,

      used:
        error.used,

      requested:
        error.requested,

      remaining:
        error.remaining,
    },
  };
}

/*
 * Build a fingerprint for everything
 * that defines this exact question
 * reservation.
 *
 * Reusing the same session ID with
 * different settings will therefore
 * fail rather than bypass quota.
 */
function buildReservationFingerprint({
  mode,
  jobRole,
  experienceLevel,
  tags,
  limit,
  selectedQuestions,
}) {
  const reservationData = {
    mode,

    jobRole:
      normalize(
        jobRole
      ),

    experienceLevel:
      normalize(
        experienceLevel
      ),

    tags:
      [...tags]
        .map(normalize)
        .sort(),

    limit,

    questionIds:
      selectedQuestions.map(
        (question) =>
          String(
            question.id
          )
      ),
  };

  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify(
        reservationData
      )
    )
    .digest("hex");
}

function createQuestionRouter({
  questionRepository,
  questionQuotaService,
  questionMetadataService,
}) {
  if (
    !questionRepository
  ) {
    throw new Error(
      "createQuestionRouter requires questionRepository."
    );
  }

  if (
    !questionQuotaService
  ) {
    throw new Error(
      "createQuestionRouter requires questionQuotaService."
    );
  }

  const router =
    express.Router();

  // Count previews can change with every tag click. Cache one per-mode
  // Firestore snapshot briefly, invalidating on question-catalog revisions.
  // A concurrent refresh shares one pending read instead of duplicating it.
  const countCache = new Map();
  const COUNT_CACHE_MS = 30000;

  async function questionsForCount(mode, fresh = false) {
    const version = questionMetadataService?.getVersion
      ? await questionMetadataService.getVersion()
      : null;
    const cached = countCache.get(mode);
    if (!fresh && cached && cached.version === version && cached.expiresAt > Date.now()) {
      return cached.questions;
    }
    if (cached && cached.version === version && cached.pending) {
      return cached.pending;
    }

    const pending = questionRepository.findByMode(mode).then((questions) => {
      countCache.set(mode, {
        version,
        questions,
        expiresAt: Date.now() + COUNT_CACHE_MS,
      });
      return questions;
    }).catch((error) => {
      if (countCache.get(mode)?.pending === pending) countCache.delete(mode);
      throw error;
    });
    countCache.set(mode, { version, pending });
    return pending;
  }

  // Read-only: does not create sessions, reserve questions, or use quota.
  router.get("/count", async (req, res, next) => {
    try {
      const mode = String(req.query.mode || "").trim();
      const jobRole = String(req.query.jobRole || "").trim();
      const experienceLevel = String(req.query.experienceLevel || "").trim();
      const tags = parseSelectedTags(req.query.tags);

      if (!ALLOWED_MODES.has(mode)) {
        return res.status(400).json({
          error: "A valid mode is required: Quiz Style, Code Style, or Theoretical Style.",
        });
      }
      if (!jobRole || !experienceLevel || tags.length === 0) {
        return res.status(400).json({
          error: "Job role, experience level, and at least one tag are required.",
        });
      }

      const questions = await questionsForCount(mode, req.query.fresh === "1");
      res.set("Cache-Control", "private, no-store");
      return res.json({
        availableCount: countEligibleQuestions(questions, { jobRole, experienceLevel, tags }),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get(
    "/quota",

    async (
      req,
      res,
      next
    ) => {
      try {
        const quota =
          await questionQuotaService
            .getStatus({
              uid:
                req.user.uid,

              role:
                req.user.role,
            });

        return res.json({
          quota,
        });
      } catch (error) {
        return next(
          error
        );
      }
    }
  );

  // New metadata endpoint; existing /options remains a compatible fallback.
  router.get("/metadata/version", async (req, res, next) => {
    try {
      if (!questionMetadataService) return res.status(503).json({ error: "Metadata unavailable." });
      res.set("Cache-Control", "private, no-store");
      return res.json({ version: await questionMetadataService.getVersion() });
    } catch (error) { return next(error); }
  });

  router.get("/metadata", async (req, res, next) => {
    try {
      if (!questionMetadataService) return res.status(503).json({ error: "Metadata unavailable." });
      res.set("Cache-Control", "private, no-store");
      return res.json(await questionMetadataService.getMetadata());
    } catch (error) { return next(error); }
  });

  router.get(
    "/options",

    async (
      req,
      res,
      next
    ) => {
      try {
        const mode =
          String(
            req.query.mode ||
              ""
          ).trim();

        if (
          !ALLOWED_MODES.has(
            mode
          )
        ) {
          return res
            .status(400)
            .json({
              error:
                "A valid mode is required: Quiz Style, Code Style, or Theoretical Style.",
            });
        }

        const jobRole =
          String(
            req.query
              .jobRole ||
              ""
          ).trim();

        const experienceLevel =
          String(
            req.query
              .experienceLevel ||
              ""
          ).trim();

        const questions =
          await questionRepository
            .findByMode(
              mode
            );

        const activeQuestions =
          questions.filter(
            (question) =>
              question.active !==
              false
          );

        const allOptions =
          buildQuestionSetupOptions(
            activeQuestions
          );

        const roleFilteredQuestions =
          jobRole
            ? activeQuestions.filter(
                (
                  question
                ) =>
                  Array.isArray(
                    question
                      .jobRoles
                  ) &&
                  question
                    .jobRoles
                    .some(
                      (role) =>
                        normalize(
                          role
                        ) ===
                        normalize(
                          jobRole
                        )
                    )
              )
            : activeQuestions;

        const roleOptions =
          buildQuestionSetupOptions(
            roleFilteredQuestions
          );

        const fullyFilteredQuestions =
          experienceLevel
            ? roleFilteredQuestions.filter(
                (
                  question
                ) =>
                  Array.isArray(
                    question
                      .experienceLevels
                  ) &&
                  question
                    .experienceLevels
                    .some(
                      (level) =>
                        normalize(
                          level
                        ) ===
                        normalize(
                          experienceLevel
                        )
                    )
              )
            : roleFilteredQuestions;

        const filteredOptions =
          buildQuestionSetupOptions(
            fullyFilteredQuestions
          );

        return res.json({
          jobRoles:
            allOptions
              .jobRoles,

          experienceLevels:
            roleOptions
              .experienceLevels,

          tags:
            filteredOptions
              .tags,
        });
      } catch (error) {
        return next(
          error
        );
      }
    }
  );

  router.get(
    "/",

    async (
      req,
      res,
      next
    ) => {
      try {
        const mode =
          String(
            req.query.mode ||
              ""
          ).trim();

        if (
          !ALLOWED_MODES.has(
            mode
          )
        ) {
          return res
            .status(400)
            .json({
              error:
                "A valid mode is required: Quiz Style, Code Style, or Theoretical Style.",
            });
        }

        const jobRole =
          String(
            req.query
              .jobRole ||
              ""
          ).trim();

        const experienceLevel =
          String(
            req.query
              .experienceLevel ||
              ""
          ).trim();

        const tags =
          parseSelectedTags(
            req.query.tags
          );

        if (
          !jobRole ||
          !experienceLevel ||
          tags.length === 0
        ) {
          return res
            .status(400)
            .json({
              error:
                "Job role, experience level, and at least one tag are required.",
            });
        }

        /*
         * The setup page creates this ID once.
         * Every question request belonging to
         * that session reuses it.
         */
        const sessionId =
          String(
            req.query
              .sessionId ||
              ""
          ).trim();

        if (
          COUNTED_MODES.has(
            mode
          )
        ) {
          if (!sessionId) {
            return res
              .status(400)
              .json({
                error:
                  "A session ID is required for Code Style and Theoretical Style question retrieval.",

                code:
                  "session-id-required",
              });
          }

          if (
            !SESSION_ID_PATTERN.test(
              sessionId
            )
          ) {
            return res
              .status(400)
              .json({
                error:
                  "The interview session ID is invalid.",

                code:
                  "invalid-session-id",
              });
          }
        }

        const requestedLimit =
          Number.parseInt(
            req.query.limit,
            10
          );

        const limit =
          Number.isFinite(
            requestedLimit
          )
            ? Math.min(
                Math.max(
                  requestedLimit,
                  1
                ),
                20
              )
            : 10;

        const questions =
          await questionRepository
            .findByMode(
              mode
            );

        const selectedQuestions =
          selectQuestions(
            questions,

            {
              jobRole,
              experienceLevel,
              tags,
            },

            limit
          ).map(
            toPublicQuestion
          );

        const reservationFingerprint =
          buildReservationFingerprint({
            mode,

            jobRole,

            experienceLevel,

            tags,

            limit,

            selectedQuestions,
          });

        let quota;

        try {
          quota =
            await questionQuotaService
              .consume({
                uid:
                  req.user.uid,

                role:
                  req.user.role,

                mode,

                count:
                  selectedQuestions
                    .length,

                reservationId:
                  sessionId,

                reservationFingerprint,
              });
        } catch (error) {
          if (
            error.code ===
            "daily-question-limit-exceeded"
          ) {
            return res
              .status(429)
              .json(
                quotaErrorResponse(
                  error
                )
              );
          }

          if (
            error.code ===
            "question-reservation-conflict"
          ) {
            return res
              .status(409)
              .json({
                error:
                  error.message,

                code:
                  error.code,
              });
          }

          throw error;
        }

        return res.json({
          questions:
            selectedQuestions,

          quota,
        });
      } catch (error) {
        return next(
          error
        );
      }
    }
  );

  router.post(
    "/:questionId/check",

    async (
      req,
      res,
      next
    ) => {
      try {
        const answer =
          String(
            req.body
              ?.answer ||
              ""
          ).trim();

        if (!answer) {
          return res
            .status(400)
            .json({
              error:
                "An answer is required.",
            });
        }

        const question =
          await questionRepository
            .findById(
              req.params
                .questionId
            );

        if (!question) {
          return res
            .status(404)
            .json({
              error:
                "Question not found.",
            });
        }

        if (
          question.mode !==
          "Quiz Style"
        ) {
          return res
            .status(400)
            .json({
              error:
                "Server-side answer checking is currently only used for Quiz Style.",
            });
        }

        const correctAnswer =
          normalize(
            question
              .correctAnswer
          );

        if (!correctAnswer) {
          return res
            .status(500)
            .json({
              error:
                "This quiz question is missing a correct answer in the data store.",
            });
        }

        const isCorrect =
          normalize(
            answer
          ) ===
          correctAnswer;

        const explanation =
          question
            .explanation ||
          (
            isCorrect
              ? "Correct."
              : "That answer is not correct. Review the topic and try another question."
          );

        return res.json({
          questionId:
            question.id,

          isCorrect,

          explanation,
        });
      } catch (error) {
        return next(
          error
        );
      }
    }
  );

  return router;
}

module.exports =
  createQuestionRouter;

module.exports
  .buildReservationFingerprint =
  buildReservationFingerprint;