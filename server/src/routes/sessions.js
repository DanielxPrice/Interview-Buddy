const express = require("express");
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
 
  // Tests can inject a fake service; the app builds the real one.
  const resultsService =
    sessionResultsService ||
    createSessionResultsService({ sessionRepository });
 
  const router = express.Router();
 
  router.use((req, res, next) => {
    if (!req.user?.uid) {
      return res.status(401).json({
        error: "Authentication is required.",
      });
    }
 
    return next();
  });
 
  // POST /api/sessions
  router.post("/", async (req, res, next) => {
    try {
      const { mode, jobRole, experienceLevel } = req.body || {};
 
      if (typeof mode !== "string" || !mode.trim()) {
        return res.status(400).json({
          error: "mode is required.",
        });
      }
 
      if (
        typeof jobRole !== "string" ||
        !jobRole.trim() ||
        typeof experienceLevel !== "string" ||
        !experienceLevel.trim()
      ) {
        return res.status(400).json({
          error: "Job role and experience level are required.",
        });
      }
 
      const session = await sessionRepository.createSession({
        userId: req.user.uid,
        mode: mode.trim(),
        jobRole: jobRole.trim(),
        experienceLevel: experienceLevel.trim(),
      });
 
      return res.status(201).json(session);
    } catch (error) {
      return next(error);
    }
  });
 
  // GET /api/sessions
  // GET /api/sessions?status=completed
  router.get("/", async (req, res, next) => {
    try {
      const { status } = req.query;
 
      if (status !== undefined && status !== "completed") {
        return res.status(400).json({
          error: "Unsupported session status filter.",
        });
      }
 
      const sessions = status === "completed"
        ? await sessionRepository.listCompletedByUser(req.user.uid)
        : await sessionRepository.listByUser(req.user.uid);
 
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
 
  // POST /api/sessions/:sessionId/quiz-answers
  router.post("/:sessionId/quiz-answers", async (req, res, next) => {
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
          error: "Question ID and answer are required.",
        });
      }
 
      if (!questionRepository) {
        return res.status(503).json({
          error: "Quiz answer storage is unavailable.",
        });
      }
 
      const question = await questionRepository.findById(
        questionId.trim()
      );
 
      if (!question) {
        return res.status(404).json({
          error: "Question not found.",
        });
      }
 
      const result = await sessionRepository.saveQuizAnswer({
        sessionId: req.params.sessionId,
        userId: req.user.uid,
        question,
        answer,
      });
 
      return res.json(result);
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          error: error.message,
        });
      }
 
      return next(error);
    }
  });
 
  // PATCH /api/sessions/:sessionId/complete
  // Completion event -> results pipeline (see sessionResultsService).
  router.patch("/:sessionId/complete", async (req, res, next) => {
    try {
      const results = await resultsService.completeSession({
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
  });
 
  return router;
}
 
module.exports = createSessionRouter;
 