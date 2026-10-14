
const express = require("express");

function createSessionRouter({ sessionRepository }) {
  if (!sessionRepository) {
    throw new Error("createSessionRouter requires sessionRepository.");
  }

  const router = express.Router();

  // POST /api/sessions
  router.post("/", async (req, res, next) => {
    try {
      const { mode, jobRole, experienceLevel } = req.body || {};

      if (!mode || typeof mode !== "string" || !mode.trim()) {
        return res.status(400).json({
          error: "mode is required.",
        });
      }

      const session = await sessionRepository.createSession({
        userId: req.user.uid,
        mode: mode.trim(),
        jobRole,
        experienceLevel,
      });

      return res.status(201).json(session);
    } catch (error) {
      return next(error);
    }
  });

  // GET /api/sessions
  router.get("/", async (req, res, next) => {
    try {
      const sessions = await sessionRepository.listByUser(
        req.user.uid
      );

      return res.json(sessions);
    } catch (error) {
      return next(error);
    }
  });

  // GET /api/sessions/:sessionId
  router.get("/:sessionId", async (req, res, next) => {
    try {
      const session = await sessionRepository.findById(
        req.params.sessionId
      );

      if (!session) {
        return res.status(404).json({
          error: "Session not found.",
        });
      }

      if (session.userId !== req.user.uid) {
        return res.status(403).json({
          error: "You do not have access to this session.",
        });
      }

      return res.json(session);
    } catch (error) {
      return next(error);
    }
  });

  // PATCH /api/sessions/:sessionId/complete
  router.patch("/:sessionId/complete", async (req, res, next) => {
    try {
      const session = await sessionRepository.findById(
        req.params.sessionId
      );

      if (!session) {
        return res.status(404).json({
          error: "Session not found.",
        });
      }

      if (session.userId !== req.user.uid) {
        return res.status(403).json({
          error: "You do not have access to this session.",
        });
      }

      const completedSession =
        await sessionRepository.completeSession(req.params.sessionId);

      if (!completedSession) {
        return res.status(404).json({
          error: "Session not found.",
        });
      }

      return res.json(completedSession);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = createSessionRouter;
