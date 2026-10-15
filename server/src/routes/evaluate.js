// server/src/routes/evaluate.js
//
// Application-layer AI evaluation route. The browser sends only a question id
// and candidate response. Private grading data is loaded through the question
// repository, AI work is delegated to aiService, and persistence is delegated
// to EvaluationRepository.

const express = require("express");
const aiService = require("../services/aiService");
const { AI_GRADABLE_MODES } = require("../services/evaluationContract");

const MAX_CANDIDATE_RESPONSE_LENGTH = 10000;

function createEvaluateRouter({
  questionRepository,
  evaluationRepository,
}) {
  if (!questionRepository) {
    throw new Error("createEvaluateRouter requires questionRepository.");
  }

  if (!evaluationRepository) {
    throw new Error("createEvaluateRouter requires evaluationRepository.");
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
        return res.status(400).json({ error: "questionId is required.",
          code: "QUESTION_NOT_FOUND",
         });
      }

      if (typeof candidateResponse !== "string" || !candidateResponse.trim()) {
        return res
          .status(400)
          .json({ error: "candidateResponse is required.",
            code: "CANDIDATE_RESPONSE_REQUIRED",
           });
      }

      if (candidateResponse.length > MAX_CANDIDATE_RESPONSE_LENGTH) {
  return res.status(400).json({
    error: "candidateResponse exceeds the maximum length of 10000 characters.",
    code: "CANDIDATE_RESPONSE_TOO_LONG",
        });
       }    

      const question = await questionRepository.findById(
        String(questionId).trim()
      );

      if (!question) {
        return res.status(404).json({ error: "Question not found.",
          code: "QUESTION_NOT_FOUND",
         });
      }

      if (!AI_GRADABLE_MODES.has(question.mode)) {
        return res.status(400).json({
          error:
            "AI evaluation is only used for Code Style and Theoretical Style questions. Quiz Style uses the deterministic quiz endpoint.",
          code: "UNSUPPORTED_EVALUATION_MODE",  
        });
      }

      if (question.active === false) {
        return res.status(409).json({ error: "This question is inactive.",
          code: "QUESTION_INACTIVE",
         });
      }

      const evaluation = await aiService.generateEvaluation({
        question,
        candidateResponse: candidateResponse.trim(),
      });

      if (metadata?.sessionId) {
        await evaluationRepository.saveEvaluation({
          sessionId: metadata.sessionId,
          questionId: question.id,
          questionPrompt: question.prompt,
          mode: question.mode,
          candidateResponse: candidateResponse.trim(),
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
