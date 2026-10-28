
"use strict";

const crypto = require("crypto");
const express = require("express");

const {
  buildQuestionSetupOptions,
  countEligibleQuestions,
  parseSelectedTags,
  selectQuestions,
} = require("../services/questionSelection");

const { getOptionsFromMetadata, countIndexedQuestions } = require("../services/questionMetadataBuilder");
const { MAX_SETUP_FILTER_LENGTH, MAX_SELECTED_TAGS } = require("../config/questionCatalogLimits");

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

// Reject large or malformed filters before any metadata or question read.
// This does not modify stored session setup or authoritative assignments.
function parsePreviewTags(raw) {
  const values = Array.isArray(raw) ? raw : [raw];
  // A comma-delimited tag list must be bounded before splitting it.
  if (values.length > MAX_SELECTED_TAGS || values.some((value) =>
    value !== undefined &&
    (typeof value !== "string" || value.length >
      (MAX_SETUP_FILTER_LENGTH + 1) * MAX_SELECTED_TAGS))) {
    throw reject("Question preview filters exceed the permitted size.", 400, "QUESTION_PREVIEW_FILTER_INVALID");
  }
  return parseSelectedTags(raw);
}

function validatePreviewFilters({ jobRole, experienceLevel, tags = [] }) {
  if ([jobRole, experienceLevel].some((value) =>
    typeof value !== "string" || value.length > MAX_SETUP_FILTER_LENGTH) ||
    !Array.isArray(tags) || tags.length > MAX_SELECTED_TAGS ||
    tags.some((tag) => typeof tag !== "string" ||
      tag.length > MAX_SETUP_FILTER_LENGTH)) {
    throw reject("Question preview filters exceed the permitted size.", 400, "QUESTION_PREVIEW_FILTER_INVALID");
  }
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

  async function questionsForCount(mode) {
    const version =
      questionMetadataService?.getVersion
        ? await questionMetadataService.getVersion()
        : null;

    const cached = countCache.get(mode);

    if (
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

      const tags = parsePreviewTags(
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

      validatePreviewFilters({ jobRole, experienceLevel, tags });

      // A client-supplied fresh=1 never bypasses the shared metadata cache.
      // Revision checks already invalidate it when the catalog changes.
      const metadata = questionMetadataService?.getMetadata
        ? await questionMetadataService.getMetadata()
        : null;
      const indexedCount = metadata
        ? countIndexedQuestions(metadata, mode, { jobRole, experienceLevel, tags })
        : null;
      const availableCount = indexedCount !== null
        ? indexedCount
        : countEligibleQuestions(await questionsForCount(mode), {
          jobRole, experienceLevel, tags,
        });

      res.set(
        "Cache-Control",
        "private, no-store"
      );

      return res.json({
        availableCount,
      });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ error: error.message, code: error.code });
      }
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
        if (error.statusCode) {
          return res.status(error.statusCode).json({ error: error.message, code: error.code });
        }
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

      validatePreviewFilters({ jobRole, experienceLevel });

      // Use the revision-aware public metadata index rather than scanning all
      // private question documents on every dropdown/filter interaction.
      const metadata = questionMetadataService?.getMetadata
        ? await questionMetadataService.getMetadata()
        : null;
      if (metadata?.modes?.[mode]?.all) {
        res.set("Cache-Control", "private, no-store");
        return res.json(getOptionsFromMetadata(metadata, mode, {
          jobRole, experienceLevel,
        }));
      }

      // Compatibility path for tests and older metadata implementations.
      // Even this path uses a server-side TTL cache: clients cannot bypass it.
      const all = (
        await questionsForCount(mode)
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
      if (error.statusCode) {
        return res.status(error.statusCode).json({ error: error.message, code: error.code });
      }
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

  // SEC-05 (S09): The legacy POST /:questionId/check route is intentionally
  // removed. It revealed correctness without a session or attempt record,
  // allowing unlimited guesses (including inactive questions). Quiz grading
  // is exclusively performed by POST /api/sessions/:sessionId/quiz-answers,
  // which enforces ownership, assignment, and one persisted answer.
  // The removed route now receives Express's normal HTTP 404 response.

  return router;
}

module.exports = createQuestionRouter;

module.exports.buildReservationFingerprint =
  buildReservationFingerprint;
