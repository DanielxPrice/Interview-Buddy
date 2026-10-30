"use strict";

const { bucketsForRequest } = require("../config/apiRateLimits");

function createApiRateLimiter({ rateLimitRepository }) {
  if (!rateLimitRepository || typeof rateLimitRepository.consume !== "function") {
    throw new Error("API rate limiter requires a rateLimitRepository.consume method.");
  }

  return async function apiRateLimiter(req, res, next) {
    if (!req.user?.uid) {
      return res.status(401).json({
        code: "auth-token-required",
        error: "Authentication is required.",
      });
    }

    try {
      const result = await rateLimitRepository.consume({
        userId: req.user.uid,
        buckets: bucketsForRequest(req),
      });

      if (!result || typeof result.allowed !== "boolean") {
        throw new Error("Rate limiter returned an invalid decision.");
      }
      if (!result.allowed) {
        const seconds = result.retryAfterSeconds;
        if (!Number.isSafeInteger(seconds) || seconds < 1) {
          throw new Error("Rate limiter returned an invalid retry period.");
        }
        res.set("Retry-After", String(seconds));
        res.set("Cache-Control", "no-store");
        return res.status(429).json({
          code: "API_RATE_LIMIT_EXCEEDED",
          error: "Too many requests. Try again shortly.",
          retryAfterSeconds: seconds,
        });
      }
      return next();
    } catch {
      // Fail closed: a broken Firestore counter must not become a bypass.
      res.set("Cache-Control", "no-store");
      return res.status(503).json({
        code: "API_RATE_LIMIT_UNAVAILABLE",
        error: "Request protection is temporarily unavailable.",
      });
    }
  };
}

module.exports = createApiRateLimiter;
