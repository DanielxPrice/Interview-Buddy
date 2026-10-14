// server/src/routes/evaluate.js
//
// Application-layer AI evaluation route. The browser sends only a question id
// and candidate response. Private grading data is loaded through the question
// repository, AI work is delegated to aiService, and persistence is delegated
// to EvaluationRepository.

const express = require("express");
const aiService = require("../services/aiService");
const { AI_GRADABLE_MODES } = require("../services/evaluationContract");

function createEvaluateRouter({
  questionRepository,
  evaluationRepository,
  sessionRepository,
}) {
  if (!questionRepository) {
    throw new Error("createEvaluateRouter requires questionRepository.");
  }

  if (!evaluationRepository) {
    throw new Error("createEvaluateRouter requires evaluationRepository.");
  }

  if (!sessionRepository) {
    throw new Error("createEvaluateRouter requires sessionRepository.");
  }

  const router = express.Router();

  // POST /api/evaluate
  // Body: { questionId, candidateResponse, requestId?, metadata? }
  router.post("/", async (req, res, next) => {
    try {
      const {
        requestId = null,
        questionId,
        candidateResponse,
        metadata = {},
      } = req.body || {};

      if (!questionId || !String(questionId).trim()) {
        return res.status(400).json({ error: "questionId is required." });
      }

      if (!candidateResponse || !String(candidateResponse).trim()) {
        return res
          .status(400)
          .json({ error: "candidateResponse is required." });
      }

      const question = await questionRepository.findById(
        String(questionId).trim()
      );

      if (!question) {
        return res.status(404).json({ error: "Question not found." });
      }

      if (!AI_GRADABLE_MODES.has(question.mode)) {
        return res.status(400).json({
          error:
            "AI evaluation is only used for Code Style and Theoretical Style questions. Quiz Style uses the deterministic quiz endpoint.",
        });
      }

      if (question.active === false) {
        return res.status(409).json({ error: "This question is inactive." });
      }
            
      if (metadata?.sessionId) {
        const session = await sessionRepository.findById(
          metadata.sessionId
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

        if (session.status === "completed") {
          return res.status(409).json({
            error: "This session has already been completed.",
          });
        }
      }

      const evaluation = await aiService.generateEvaluation({
        question,
        candidateResponse: String(candidateResponse).trim(),
      });

      if (metadata?.sessionId) {
        await evaluationRepository.saveEvaluation({
          sessionId: metadata.sessionId,
          questionId: question.id,
          questionPrompt: question.prompt,
          mode: question.mode,
          candidateResponse: String(candidateResponse).trim(),
          evaluation,
          metadata,
          evaluatedAt: new Date().toISOString(),
        });
      }

      return res.json({
        requestId,
        questionId: question.id,
        evaluation,
      });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          error: error.message,
          requestId: req.body?.requestId || null,
        });
      }

      return next(error);
    }
  });

  return router;
}

module.exports = createEvaluateRouter;
