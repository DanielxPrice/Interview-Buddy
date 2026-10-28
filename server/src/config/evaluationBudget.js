
"use strict";

const {
  readPositiveInteger,
  DAILY_QUESTION_QUOTA_TIME_ZONE,
} = require("./questionQuota");

// Independent of the existing daily question retrieval limit.
// Every newly reserved provider attempt uses one unit.
// Provider failures are not refunded because an external
// provider may already have billed the call.
const DEFAULT_USER_DAILY_AI_EVALUATION_LIMIT = 20;

const USER_DAILY_AI_EVALUATION_LIMIT =
  readPositiveInteger(
    process.env.USER_DAILY_AI_EVALUATION_LIMIT,
    DEFAULT_USER_DAILY_AI_EVALUATION_LIMIT
  );

// Use the same agreed day boundary as
// the question retrieval quota.
const DAILY_AI_EVALUATION_TIME_ZONE =
  DAILY_QUESTION_QUOTA_TIME_ZONE;

module.exports = {
  DEFAULT_USER_DAILY_AI_EVALUATION_LIMIT,
  USER_DAILY_AI_EVALUATION_LIMIT,
  DAILY_AI_EVALUATION_TIME_ZONE,
};
