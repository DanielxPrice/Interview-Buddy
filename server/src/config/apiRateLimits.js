"use strict";

// Fixed, one-minute per-user limits. These are not substitutes for edge/IP
// protection against requests that never pass Firebase authentication.
const WINDOW_MS = 60 * 1000;
const RETENTION_MS = 24 * 60 * 60 * 1000;

function readLimit(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 10000) {
    throw new Error(`${name} must be an integer between 1 and 10000.`);
  }
  return value;
}

const API_RATE_LIMITS = Object.freeze({
  global: readLimit("API_RATE_LIMIT_GLOBAL_PER_MINUTE", 120),
  questions: readLimit("API_RATE_LIMIT_QUESTIONS_PER_MINUTE", 40),
  evaluations: readLimit("API_RATE_LIMIT_EVALUATIONS_PER_MINUTE", 12),
  sessionWrites: readLimit("API_RATE_LIMIT_SESSION_WRITES_PER_MINUTE", 40),
  users: readLimit("API_RATE_LIMIT_USERS_PER_MINUTE", 30),
});

// Each request uses a global window plus, when relevant, a category window.
// Buckets are determined by server-side route and verb, never by request data.
function bucketsForRequest(req) {
  const buckets = ["global"];
  switch (req.baseUrl) {
    case "/api/questions":
      buckets.push("questions");
      break;
    case "/api/evaluate":
      buckets.push("evaluations");
      break;
    case "/api/sessions":
      if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
        buckets.push("sessionWrites");
      }
      break;
    case "/api/users":
      buckets.push("users");
      break;
    default:
      break;
  }
  return buckets;
}

module.exports = {
  WINDOW_MS,
  RETENTION_MS,
  API_RATE_LIMITS,
  bucketsForRequest,
  readLimit,
};
