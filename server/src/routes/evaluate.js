
"use strict";

const express = require("express");
const aiService = require("../services/aiService");

const {
  AI_GRADABLE_MODES,
} = require("../services/evaluationContract");

const {
  SESSION_ID_PATTERN,
  assertOwnedActiveSession,
  assertAssignedQuestion,
  reject,
} = require("../services/sessionAssignmentPolicy");

const MAX_CANDIDATE_RESPONSE_LENGTH = 10000;

function createEvaluateRouter({
  questionRepository,
  evaluationRepository,
  sessionRepository,
}) {
  if (!questionRepository) {
    throw new Error(
      "createEvaluateRouter requires questionRepository."
    );
  }

  if (!evaluationRepository) {
    throw new Error(
      "createEvaluateRouter requires evaluationRepository."
    );
  }

  if (!sessionRepository) {
    throw new Error(
      "createEvaluateRouter requires sessionRepository."
    );
  }

  // SEC-04 requires reservation-aware persistence. Fail closed if a test or
  // deployment accidentally injects a legacy repository.
  for (const method of [
    "reserveEvaluation",
    "completeReservedEvaluation",
    "failReservedEvaluation",
    "markProviderStarted",
    "markUncertainEvaluation",
  ]) {
    if (typeof evaluationRepository[method] !== "function") {
      throw new Error(`createEvaluateRouter requires evaluationRepository.${method}.`);
    }
  }

  const router = express.Router();

  // POST /api/evaluate
  // Body: {
  //   questionId,
  //   candidateResponse,
  //   requestId?,
  //   metadata: { sessionId }
  // }
  router.post("/", async (req, res, next) => {
    try {
      const {
        questionId,
        candidateResponse,
        requestId = null,
        metadata = {},
      } = req.body || {};

      if (
        typeof questionId !== "string" ||
        !questionId.trim()
      ) {
        return res.status(400).json({
          error: "questionId is required.",
          code: "QUESTION_NOT_FOUND",
        });
      }

      if (
        typeof candidateResponse !== "string" ||
        !candidateResponse.trim()
      ) {
        return res.status(400).json({
          error: "candidateResponse is required.",
          code: "CANDIDATE_RESPONSE_REQUIRED",
        });
      }

      if (
        candidateResponse.length >
        MAX_CANDIDATE_RESPONSE_LENGTH
      ) {
        return res.status(400).json({
          error:
            "candidateResponse exceeds the maximum length of 10000 characters.",
          code: "CANDIDATE_RESPONSE_TOO_LONG",
        });
      }

      // requestId is informational only; it is not the reservation key.
      if (
        requestId !== null &&
        (typeof requestId !== "string" ||
          requestId.length > 128 ||
          !/^[A-Za-z0-9_-]+$/.test(requestId))
      ) {
        return res.status(400).json({
          error: "requestId has an invalid format.",
          code: "INVALID_REQUEST_ID",
        });
      }

      if (
        metadata === null ||
        typeof metadata !== "object" ||
        Array.isArray(metadata)
      ) {
        return res.status(400).json({
          error: "metadata must be an object.",
          code: "METADATA_INVALID",
        });
      }

      if (
        (metadata.sessionId !== undefined &&
          metadata.sessionId !== null &&
          typeof metadata.sessionId !== "string") ||
        (metadata.jobRole !== undefined &&
          typeof metadata.jobRole !== "string") ||
        (metadata.experienceLevel !== undefined &&
          typeof metadata.experienceLevel !== "string")
      ) {
        return res.status(400).json({
          error:
            "metadata fields have invalid types.",
          code: "METADATA_FIELD_INVALID",
        });
      }

      // Every paid AI evaluation must belong
      // to an existing interview session.
      const sessionId = metadata.sessionId;

      if (
        typeof sessionId !== "string" ||
        !sessionId.trim()
      ) {
        return res.status(400).json({
          error:
            "metadata.sessionId is required for AI evaluation.",
          code: "SESSION_ID_REQUIRED",
        });
      }

      const normalizedQuestionId =
        questionId.trim();

      if (
        !SESSION_ID_PATTERN.test(sessionId) ||
        !SESSION_ID_PATTERN.test(
          normalizedQuestionId
        )
      ) {
        return res.status(400).json({
          error:
            "Session ID or question ID is invalid.",
          code: "INVALID_IDENTIFIER",
        });
      }

      // Check authorization before loading
      // private grading data or calling AI.
      const session =
        await sessionRepository.findById(
          sessionId
        );

      assertOwnedActiveSession(
        session,
        req.user.uid
      );

      if (!AI_GRADABLE_MODES.has(session.mode)) {
        throw reject(
          "AI evaluation is only supported for Code Style and Theoretical Style sessions.",
          400,
          "UNSUPPORTED_EVALUATION_MODE"
        );
      }

      if (
        session.assignmentStatus !==
        "assigned"
      ) {
        throw reject(
          "This interview has no finalized question assignment.",
          409,
          "ASSIGNMENT_NOT_READY"
        );
      }

      assertAssignedQuestion(
        session,
        normalizedQuestionId
      );

      // Compare optional metadata to
      // the saved interview configuration.
      if (
        (metadata.jobRole &&
          metadata.jobRole.trim().toLowerCase() !==
            String(
              session.jobRole || ""
            ).trim().toLowerCase()) ||
        (metadata.experienceLevel &&
          metadata.experienceLevel.trim().toLowerCase() !==
            String(
              session.experienceLevel || ""
            ).trim().toLowerCase())
      ) {
        throw reject(
          "Evaluation settings differ from the original interview.",
          409,
          "SESSION_SETUP_MISMATCH"
        );
      }

      const question =
        await questionRepository.findById(
          normalizedQuestionId
        );

      if (!question) {
        return res.status(404).json({
          error: "Question not found.",
          code: "QUESTION_NOT_FOUND",
        });
      }

      if (
        !AI_GRADABLE_MODES.has(question.mode)
      ) {
        return res.status(400).json({
          error:
            "AI evaluation is only used for Code Style and Theoretical Style questions. Quiz Style uses the deterministic quiz endpoint.",
          code: "UNSUPPORTED_EVALUATION_MODE",
        });
      }

      if (
        question.mode !== session.mode
      ) {
        throw reject(
          "Question mode does not match the active interview session.",
          409,
          "SESSION_MODE_MISMATCH"
        );
      }

      if (question.active === false) {
        return res.status(409).json({
          error: "This question is inactive.",
          code: "QUESTION_INACTIVE",
        });
      }

      const answer =
        candidateResponse.trim();

      // Atomic claim happens BEFORE the paid provider call. Question ID is
      // the lock key, so a changed client requestId cannot evade it.
      const admission = await evaluationRepository.reserveEvaluation({
        userId: req.user.uid,
        role: req.user.role,
        sessionId,
        questionId: question.id,
        mode: question.mode,
        candidateResponse: answer,
        requestId,
      });

      if (admission.kind === "replay") {
        return res.json({
          requestId,
          questionId: question.id,
          evaluation: admission.evaluation,
          replayed: true,
        });
      }

      if (admission.kind !== "reserved" || !admission.attemptId) {
        throw new Error("Evaluation reservation returned an invalid result.");
      }

      // The ONLY allowed path to the provider is through this durable
      // dispatch marker. An undispatched reservation may be reclaimed after
      // expiry; a provider_started reservation must not be reclaimed blindly.
      await evaluationRepository.markProviderStarted({
        userId: req.user.uid,
        sessionId,
        questionId: question.id,
        mode: question.mode,
        attemptId: admission.attemptId,
      });

      let evaluation;
      try {
        // Exactly one application-level attempt; SDK retries are disabled.
        evaluation = await aiService.generateEvaluation({
          question,
          candidateResponse: answer,
        });
      } catch (_providerError) {
        // Connection reset, timeout, invalid response, or SDK error does not
        // prove the provider did not process and bill this evaluation.
        try {
          await evaluationRepository.markUncertainEvaluation({
            userId: req.user.uid,
            sessionId,
            questionId: question.id,
            attemptId: admission.attemptId,
          });
        } catch (stateError) {
          // provider_started remains a durable fail-closed lock even if this
          // transition fails. Log operational detail only on the backend.
          console.error("Unable to mark uncertain AI evaluation:", stateError);
        }
        return res.status(503).json({
          error: "The evaluation could not be confirmed. Its outcome needs review before retrying.",
          code: "EVALUATION_REVIEW_REQUIRED",
          requestId,
        });
      }

      // Persistence transaction checks session, assignment and ownership
      // *again* and requires the same server-generated reservation token.
      await evaluationRepository.completeReservedEvaluation({
        userId: req.user.uid,
        sessionId,
        questionId: question.id,
        questionPrompt: question.prompt,
        mode: question.mode,
        candidateResponse: answer,
        evaluation,
        attemptId: admission.attemptId,
        evaluatedAt: new Date().toISOString(),
      });

      return res.json({
        requestId,
        questionId: question.id,
        evaluation,
      });
    } catch (error) {
      if (error.statusCode) {
        const body = {
          error: error.message,
          requestId:
            req.body?.requestId || null,
        };

        if (error.code) {
          body.code = error.code;
        }

        return res
          .status(error.statusCode)
          .json(body);
      }

      return next(error);
    }
  });

  return router;
}

module.exports = createEvaluateRouter;
