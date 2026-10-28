
"use strict";

const crypto = require("crypto");
const express = require("express");

const {
  buildQuestionSetupOptions,
  countEligibleQuestions,
  parseSelectedTags,
  selectQuestions,
} = require("../services/questionSelection");

const {
  MODES,
  SESSION_ID_PATTERN,
  sameSetup,
  assertOwnedActiveSession,
  reject,
} = require("../services/sessionAssignmentPolicy");

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

// Deliberately exclude correctAnswer,
// referenceAnswer, and gradingCriteria.
function toPublicQuestion(question) {
  return {
    id: question.id,
    mode: question.mode,
    prompt: question.prompt,
    options: Array.isArray(question.options)
      ? question.options
      : [],
    difficulty: question.difficulty || "",
    topic: question.topic || "",
    tags: Array.isArray(question.tags)
      ? question.tags
      : [],
  };
}

function quotaErrorResponse(error) {
  return {
    error: error.message,
    code: error.code,
    quota: {
      limit: error.limit,
      used: error.used,
      requested: error.requested,
      remaining: error.remaining,
    },
  };
}

function buildReservationFingerprint({
  mode,
  jobRole,
  experienceLevel,
  tags,
  limit,
  selectedQuestions,
}) {
  const canonical = {
    mode,
    jobRole: normalize(jobRole),
    experienceLevel: normalize(experienceLevel),
    tags: [...tags].map(normalize).sort(),
    limit,
    questionIds: selectedQuestions.map(
      (question) => String(question.id)
    ),
  };

  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
}

function parseRetrievalSetup(query, session) {
  const mode = query.mode;
  const jobRole = query.jobRole;
  const experienceLevel = query.experienceLevel;
  const tags = parseSelectedTags(query.tags);

  if (!MODES.has(mode)) {
    throw reject(
      "A supported interview mode is required."
    );
  }

  if (
    typeof jobRole !== "string" ||
    !jobRole.trim() ||
    typeof experienceLevel !== "string" ||
    !experienceLevel.trim() ||
    !tags.length
  ) {
    throw reject(
      "Job role, experience level, and at least one tag are required."
    );
  }

  const requestedCount =
    query.limit === undefined
      ? session.questionCount
      : Number(query.limit);

  if (
    !Number.isInteger(requestedCount) ||
    requestedCount < 1 ||
    requestedCount > 20
  ) {
    throw reject(
      "Question count must be an integer between 1 and 20."
    );
  }

  const setup = {
    mode,
    jobRole: jobRole.trim(),
    experienceLevel: experienceLevel.trim(),
    tags,
    questionCount: requestedCount,
  };

  if (!sameSetup(session, setup)) {
    throw reject(
      "Interview settings differ from the original session.",
      409,
      "SESSION_SETUP_MISMATCH"
    );
  }

  return setup;
}

function getSavedAssignment(session) {
  if (session.assignmentStatus !== "assigned") {
    return null;
  }

  const ids = session.assignedQuestionIds;
  const questions = session.assignedQuestions;

  if (
    !Array.isArray(ids) ||
    !Array.isArray(questions) ||
    questions.length !== session.questionCount ||
    ids.length !== questions.length ||
    new Set(ids).size !== ids.length ||
    questions.some(
      (question, index) =>
        !question ||
        question.id !== ids[index] ||
        question.mode !== session.mode ||
        typeof question.prompt !== "string" ||
        !question.prompt.trim()
    )
  ) {
    throw reject(
      "Saved question assignment is invalid.",
      409,
      "ASSIGNMENT_CORRUPTED"
    );
  }

  return questions.map(toPublicQuestion);
}

function createQuestionRouter({
  questionRepository,
  questionQuotaService,
  questionMetadataService,
  sessionRepository,
}) {
  if (!questionRepository) {
    throw new Error(
      "createQuestionRouter requires questionRepository."
    );
  }

  if (!questionQuotaService) {
    throw new Error(
      "createQuestionRouter requires questionQuotaService."
    );
  }

  if (
    !sessionRepository ||
    typeof sessionRepository.assignQuestions !==
      "function"
  ) {
    throw new Error(
      "createQuestionRouter requires a sessionRepository with assignQuestions()."
    );
  }

  const router = express.Router();

  // Count previews are read-only and briefly cached.
  const countCache = new Map();
  const COUNT_CACHE_MS = 30000;

  async function questionsForCount(
    mode,
    fresh = false
  ) {
    const version =
      questionMetadataService?.getVersion
        ? await questionMetadataService.getVersion()
        : null;

    const cached = countCache.get(mode);

    if (
      !fresh &&
      cached &&
      cached.version === version &&
      cached.expiresAt > Date.now()
    ) {
      return cached.questions;
    }

    if (
      cached &&
      cached.version === version &&
      cached.pending
    ) {
      return cached.pending;
    }

    const pending = questionRepository
      .findByMode(mode)
      .then((questions) => {
        countCache.set(mode, {
          version,
          questions,
          expiresAt:
            Date.now() + COUNT_CACHE_MS,
        });

        return questions;
      })
      .catch((error) => {
        if (countCache.get(mode)?.pending === pending) {
          countCache.delete(mode);
        }

        throw error;
      });

    countCache.set(mode, {
      version,
      pending,
    });

    return pending;
  }

  // Read-only availability preview.
  router.get("/count", async (req, res, next) => {
    try {
      const mode = String(
        req.query.mode || ""
      ).trim();

      const jobRole = String(
        req.query.jobRole || ""
      ).trim();

      const experienceLevel = String(
        req.query.experienceLevel || ""
      ).trim();

      const tags = parseSelectedTags(
        req.query.tags
      );

      if (!MODES.has(mode)) {
        return res.status(400).json({
          error:
            "A valid mode is required: Quiz Style, Code Style, or Theoretical Style.",
        });
      }

      if (
        !jobRole ||
        !experienceLevel ||
        !tags.length
      ) {
        return res.status(400).json({
          error:
            "Job role, experience level, and at least one tag are required.",
        });
      }

      const questions = await questionsForCount(
        mode,
        req.query.fresh === "1"
      );

      res.set(
        "Cache-Control",
        "private, no-store"
      );

      return res.json({
        availableCount: countEligibleQuestions(
          questions,
          {
            jobRole,
            experienceLevel,
            tags,
          }
        ),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/quota", async (req, res, next) => {
    try {
      const quota =
        await questionQuotaService.getStatus({
          uid: req.user.uid,
          role: req.user.role,
        });

      return res.json({ quota });
    } catch (error) {
      return next(error);
    }
  });

  router.get(
    "/metadata/version",
    async (req, res, next) => {
      try {
        if (!questionMetadataService) {
          return res.status(503).json({
            error: "Metadata unavailable.",
          });
        }

        res.set(
          "Cache-Control",
          "private, no-store"
        );

        return res.json({
          version:
            await questionMetadataService.getVersion(),
        });
      } catch (error) {
        return next(error);
      }
    }
  );

  router.get(
    "/metadata",
    async (req, res, next) => {
      try {
        if (!questionMetadataService) {
          return res.status(503).json({
            error: "Metadata unavailable.",
          });
        }

        res.set(
          "Cache-Control",
          "private, no-store"
        );

        return res.json(
          await questionMetadataService.getMetadata()
        );
      } catch (error) {
        return next(error);
      }
    }
  );

  // Existing setup dropdowns remain supported.
  router.get("/options", async (req, res, next) => {
    try {
      const mode = String(
        req.query.mode || ""
      ).trim();

      if (!MODES.has(mode)) {
        return res.status(400).json({
          error:
            "A valid mode is required: Quiz Style, Code Style, or Theoretical Style.",
        });
      }

      const jobRole = String(
        req.query.jobRole || ""
      ).trim();

      const experienceLevel = String(
        req.query.experienceLevel || ""
      ).trim();

      const all = (
        await questionRepository.findByMode(mode)
      ).filter(
        (question) => question.active !== false
      );

      const roleMatched = jobRole
        ? all.filter(
            (question) =>
              Array.isArray(question.jobRoles) &&
              question.jobRoles.some(
                (role) =>
                  normalize(role) ===
                  normalize(jobRole)
              )
          )
        : all;

      const fullyMatched = experienceLevel
        ? roleMatched.filter(
            (question) =>
              Array.isArray(
                question.experienceLevels
              ) &&
              question.experienceLevels.some(
                (level) =>
                  normalize(level) ===
                  normalize(experienceLevel)
              )
          )
        : roleMatched;

      return res.json({
        jobRoles:
          buildQuestionSetupOptions(all).jobRoles,
        experienceLevels:
          buildQuestionSetupOptions(
            roleMatched
          ).experienceLevels,
        tags:
          buildQuestionSetupOptions(
            fullyMatched
          ).tags,
      });
    } catch (error) {
      return next(error);
    }
  });

  // Authoritative interview question retrieval.
  router.get("/", async (req, res, next) => {
    try {
      const sessionId = req.query.sessionId;

      if (
        typeof sessionId !== "string" ||
        !sessionId.trim()
      ) {
        return res.status(400).json({
          error:
            "A session ID is required for interview question retrieval.",
          code: "session-id-required",
        });
      }

      if (!SESSION_ID_PATTERN.test(sessionId)) {
        return res.status(400).json({
          error:
            "The interview session ID is invalid.",
          code: "invalid-session-id",
        });
      }

      const session =
        await sessionRepository.findById(
          sessionId
        );

      assertOwnedActiveSession(
        session,
        req.user.uid
      );

      const setup = parseRetrievalSetup(
        req.query,
        session
      );

      // A retry returns the original assignment.
      // It does not reselect or reserve quota.
      if (
        session.assignmentStatus === "assigned"
      ) {
        const saved = getSavedAssignment(
          session
        );

        const quota =
          await questionQuotaService.getStatus({
            uid: req.user.uid,
            role: req.user.role,
          });

        res.set(
          "Cache-Control",
          "private, no-store"
        );

        return res.json({
          questions: saved,
          quota,
        });
      }

      if (
        session.assignmentStatus !== "pending"
      ) {
        throw reject(
          "This interview cannot receive question assignments.",
          409,
          "SESSION_ASSIGNMENT_UNAVAILABLE"
        );
      }

      const candidates =
        await questionRepository.findByMode(
          setup.mode
        );

      const selected = selectQuestions(
        candidates,
        setup,
        setup.questionCount
      ).map(toPublicQuestion);

      if (
        selected.length !== setup.questionCount
      ) {
        throw reject(
          "Not enough active questions match the saved interview setup.",
          409,
          "INSUFFICIENT_MATCHING_QUESTIONS"
        );
      }

      const fingerprint =
        buildReservationFingerprint({
          mode: setup.mode,
          jobRole: setup.jobRole,
          experienceLevel:
            setup.experienceLevel,
          tags: setup.tags,
          limit: setup.questionCount,
          selectedQuestions: selected,
        });

      // The existing quota service uses a
      // stable reservation per session ID.
      const quota =
        await questionQuotaService.consume({
          uid: req.user.uid,
          role: req.user.role,
          mode: setup.mode,
          count: selected.length,
          reservationId: sessionId,
          reservationFingerprint:
            fingerprint,
        });

      // Firestore transaction freezes the
      // first committed question assignment.
      const assigned =
        await sessionRepository.assignQuestions({
          sessionId,
          userId: req.user.uid,
          setup,
          questions: selected,
        });

      res.set(
        "Cache-Control",
        "private, no-store"
      );

      return res.json({
        questions:
          assigned.map(toPublicQuestion),
        quota,
      });
    } catch (error) {
      if (
        error.code ===
        "daily-question-limit-exceeded"
      ) {
        return res.status(429).json(
          quotaErrorResponse(error)
        );
      }

      if (
        error.code ===
        "question-reservation-conflict"
      ) {
        return res.status(409).json({
          error: error.message,
          code: error.code,
        });
      }

      if (error.statusCode) {
        return res
          .status(error.statusCode)
          .json({
            error: error.message,
            code: error.code,
          });
      }

      return next(error);
    }
  });

  // Legacy Quiz answer-checking endpoint.
  // SEC-05 will remove or restrict this
  // endpoint because it can act as an oracle.
  router.post(
    "/:questionId/check",
    async (req, res, next) => {
      try {
        const answer = String(
          req.body?.answer || ""
        ).trim();

        if (!answer) {
          return res.status(400).json({
            error: "An answer is required.",
          });
        }

        const question =
          await questionRepository.findById(
            req.params.questionId
          );

        if (!question) {
          return res.status(404).json({
            error: "Question not found.",
          });
        }

        if (question.mode !== "Quiz Style") {
          return res.status(400).json({
            error:
              "Server-side answer checking is currently only used for Quiz Style.",
          });
        }

        const correct = normalize(
          question.correctAnswer
        );

        if (!correct) {
          return res.status(500).json({
            error:
              "This quiz question is missing a correct answer in the data store.",
          });
        }

        const isCorrect =
          normalize(answer) === correct;

        return res.json({
          questionId: question.id,
          isCorrect,
          explanation:
            question.explanation ||
            (isCorrect
              ? "Correct."
              : "That answer is not correct. Review the topic and try another question."),
        });
      } catch (error) {
        return next(error);
      }
    }
  );

  return router;
}

module.exports = createQuestionRouter;

module.exports.buildReservationFingerprint =
  buildReservationFingerprint;
