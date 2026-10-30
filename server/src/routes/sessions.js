
const express = require("express");
const { SESSION_HISTORY_PAGE_MAX } = require("../config/sessionStorageLimits");

const {
  validateSessionSetup,
  SESSION_ID_PATTERN,
  assertOwnedActiveSession,
  assertAssignedQuestion,
  reject,
} = require("../services/sessionAssignmentPolicy");

const {
  createSessionResultsService,
} = require("../services/sessionResultsService");

function createSessionRouter({
  sessionRepository,
  questionRepository,
  sessionResultsService,
}) {
  if (!sessionRepository) {
    throw new Error(
      "createSessionRouter requires sessionRepository."
    );
  }

  const resultsService =
    sessionResultsService ||
    createSessionResultsService({
      sessionRepository,
    });

  const router = express.Router();

  router.use((req, res, next) => {
    if (!req.user?.uid) {
      return res.status(401).json({
        error: "Authentication is required.",
      });
    }

    return next();
  });

  // Create an interview session.
  router.post("/", async (req, res, next) => {
    try {
      let setup;

      try {
        setup = validateSessionSetup(req.body || {});
      } catch (error) {
        return res.status(error.statusCode || 400).json({
          error: error.message,
          code: error.code,
        });
      }

      const session =
        await sessionRepository.createSession({
          userId: req.user.uid,
          ...setup,
        });

      return res.status(201).json(session);
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ error: error.message, code: error.code });
      }
      return next(error);
    }
  });

  // List the authenticated user's sessions.
  router.get("/", async (req, res, next) => {
    try {
      const { status } = req.query;

      if (
        status !== undefined &&
        status !== "completed"
      ) {
        return res.status(400).json({
          error: "Unsupported session status filter.",
        });
      }

      const wantsPage = req.query.pageSize !== undefined || req.query.cursor !== undefined;
      if (wantsPage) {
        const rawPageSize = req.query.pageSize;
        const pageSize = Number(rawPageSize);
        if (typeof rawPageSize !== "string" || !/^[0-9]+$/.test(rawPageSize) ||
            !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > SESSION_HISTORY_PAGE_MAX) {
          return res.status(400).json({ error: "Invalid history page size.", code: "SESSION_PAGE_SIZE_INVALID" });
        }
        const cursor = req.query.cursor;
        if (cursor !== undefined &&
            (typeof cursor !== "string" || !SESSION_ID_PATTERN.test(cursor))) {
          return res.status(400).json({ error: "Invalid history cursor.", code: "SESSION_CURSOR_INVALID" });
        }
        const page = await sessionRepository.getSessionPage({
          userId: req.user.uid, status: status || null, pageSize,
          cursor: cursor || null,
        });
        return res.json(page);
      }

      // Retain the original array shape for existing callers, but the repository
      // limits this query to the newest 50 sessions.
      const sessions = status === "completed"
        ? await sessionRepository.listCompletedByUser(req.user.uid)
        : await sessionRepository.listByUser(req.user.uid);
      return res.json(sessions);
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ error: error.message, code: error.code });
      }
      return next(error);
    }
  });

  // SEC-03 M06:
  // Retrieve stored results with public question feedback.
  // This route does NOT recalculate grades or finalize sessions.
  router.get(
    "/:sessionId/results",
    async (req, res, next) => {
      try {
        if (
          !SESSION_ID_PATTERN.test(req.params.sessionId)
        ) {
          return res.status(400).json({
            error: "Invalid session ID.",
            code: "INVALID_SESSION_ID",
          });
        }

        const results =
          await resultsService.getCompletedSessionResults({
            sessionId: req.params.sessionId,
            userId: req.user.uid,
          });

        res.set("Cache-Control", "private, no-store");

        return res.json(results);
      } catch (error) {
        if (error.statusCode) {
          return res.status(error.statusCode).json({
            error: error.message,
            code: error.code,
          });
        }

        return next(error);
      }
    }
  );

  // Retrieve a single session's summary.
  router.get(
    "/:sessionId",
    async (req, res, next) => {
      try {
        const session =
          await sessionRepository.findById(
            req.params.sessionId
          );

        if (!session) {
          return res.status(404).json({
            error: "Session not found.",
            code: "SESSION_NOT_FOUND",
          });
        }

        // SEC-03 M09:
        // An authenticated user may only see their own session.
        if (session.userId !== req.user.uid) {
          return res.status(403).json({
            error:
              "You do not have access to this session.",
            code: "SESSION_FORBIDDEN",
          });
        }

        return res.json(session);
      } catch (error) {
        return next(error);
      }
    }
  );

  // Save an answer to a session-assigned Quiz question.
  router.post(
    "/:sessionId/quiz-answers",
    async (req, res, next) => {
      try {
        const questionId = req.body?.questionId;
        const answer = req.body?.answer;

        if (
          typeof questionId !== "string" ||
          !questionId.trim() ||
          typeof answer !== "string" ||
          !answer.trim()
        ) {
          return res.status(400).json({
            error:
              "Question ID and answer are required.",
          });
        }

        const sessionId = req.params.sessionId;
        const normalizedId = questionId.trim();

        if (
          !SESSION_ID_PATTERN.test(sessionId) ||
          !SESSION_ID_PATTERN.test(normalizedId)
        ) {
          return res.status(400).json({
            error:
              "Session ID or question ID is invalid.",
            code: "INVALID_IDENTIFIER",
          });
        }

        const session =
          await sessionRepository.findById(sessionId);

        assertOwnedActiveSession(
          session,
          req.user.uid
        );

        if (session.mode !== "Quiz Style") {
          throw reject(
            "Question mode does not match the interview session.",
            409,
            "SESSION_MODE_MISMATCH"
          );
        }

        if (session.assignmentStatus !== "assigned") {
          throw reject(
            "This interview has no finalized question assignment.",
            409,
            "ASSIGNMENT_NOT_READY"
          );
        }

        assertAssignedQuestion(
          session,
          normalizedId
        );

        if (!questionRepository) {
          return res.status(503).json({
            error:
              "Quiz answer storage is unavailable.",
          });
        }

        const question =
          await questionRepository.findById(
            normalizedId
          );

        if (!question) {
          return res.status(404).json({
            error: "Question not found.",
          });
        }

        const result =
          await sessionRepository.saveQuizAnswer({
            sessionId,
            userId: req.user.uid,
            question,
            answer,
          });

        return res.json(result);
      } catch (error) {
        if (error.statusCode) {
          return res.status(error.statusCode).json({
            error: error.message,
            code: error.code,
          });
        }

        return next(error);
      }
    }
  );

  // Finalize an interview using server-calculated results.
  router.patch(
    "/:sessionId/complete",
    async (req, res, next) => {
      try {
        const results =
          await resultsService.completeSession({
            sessionId: req.params.sessionId,
            userId: req.user.uid,
          });

        return res.json(results);
      } catch (error) {
        if (error.statusCode) {
          return res.status(error.statusCode).json({
            error: error.message,
            code: error.code,
          });
        }

        return next(error);
      }
    }
  );

  return router;
}

module.exports = createSessionRouter;
