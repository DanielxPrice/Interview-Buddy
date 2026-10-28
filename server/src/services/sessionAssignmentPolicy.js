
"use strict";

const {
  parseSelectedTags,
} = require("./questionSelection");

const MODES = new Set([
  "Quiz Style",
  "Code Style",
  "Theoretical Style",
]);

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function reject(
  message,
  statusCode = 400,
  code = "INVALID_SESSION_SETUP"
) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalize(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTags(value) {
  if (!Array.isArray(value) && typeof value !== "string") {
    return [];
  }

  return parseSelectedTags(value).sort();
}

function validateSessionSetup({
  mode,
  jobRole,
  experienceLevel,
  tags,
  questionCount,
}) {
  if (!MODES.has(mode)) {
    throw reject("A supported interview mode is required.");
  }

  const role = normalize(jobRole);
  const experience = normalize(experienceLevel);
  const selectedTags = normalizeTags(tags);

  if (
    !role ||
    role.length > 100 ||
    !experience ||
    experience.length > 50
  ) {
    throw reject(
      "Valid job role and experience level are required."
    );
  }

  if (
    selectedTags.length < 1 ||
    selectedTags.length > 20 ||
    selectedTags.some((tag) => tag.length > 100)
  ) {
    throw reject(
      "Select between 1 and 20 valid practice tags."
    );
  }

  if (
    !Number.isInteger(questionCount) ||
    questionCount < 1 ||
    questionCount > 20
  ) {
    throw reject(
      "Question count must be an integer between 1 and 20."
    );
  }

  return {
    mode,
    jobRole: role,
    experienceLevel: experience,
    tags: selectedTags,
    questionCount,
  };
}

function sameSetup(session, requested) {
  return (
    session.mode === requested.mode &&
    normalize(session.jobRole).toLowerCase() ===
      normalize(requested.jobRole).toLowerCase() &&
    normalize(session.experienceLevel).toLowerCase() ===
      normalize(requested.experienceLevel).toLowerCase() &&
    JSON.stringify(normalizeTags(session.tags)) ===
      JSON.stringify(normalizeTags(requested.tags)) &&
    session.questionCount === requested.questionCount
  );
}

function assertOwnedActiveSession(session, userId) {
  if (!session) {
    throw reject(
      "Session not found.",
      404,
      "SESSION_NOT_FOUND"
    );
  }

  if (session.userId !== userId) {
    throw reject(
      "You do not have access to this session.",
      403,
      "SESSION_FORBIDDEN"
    );
  }

  if (session.status !== "active") {
    throw reject("This session is not active.", 409, "SESSION_NOT_ACTIVE");
  }

  // Legacy sessions without an expiry remain accessible until migrated.
  // New SEC-05 sessions cannot receive answers after their bounded lifetime.
  if (Number.isSafeInteger(session.activeExpiresAtMs) &&
      session.activeExpiresAtMs <= Date.now()) {
    throw reject("This interview has expired. Start a new interview.", 409, "SESSION_EXPIRED");
  }
}

function assertAssignedQuestion(session, questionId) {
  if (
    !Array.isArray(session?.assignedQuestionIds) ||
    !session.assignedQuestionIds.includes(questionId)
  ) {
    throw reject(
      "Question was not assigned to this interview.",
      409,
      "QUESTION_NOT_ASSIGNED"
    );
  }
}

module.exports = {
  MODES,
  SESSION_ID_PATTERN,
  reject,
  normalizeTags,
  validateSessionSetup,
  sameSetup,
  assertOwnedActiveSession,
  assertAssignedQuestion,
};
