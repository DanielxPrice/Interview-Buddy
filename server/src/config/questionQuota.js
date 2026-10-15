const DEFAULT_USER_DAILY_QUESTION_LIMIT = 20;

const DEFAULT_DAILY_QUESTION_QUOTA_TIME_ZONE =
  "America/Los_Angeles";

function readPositiveInteger(
  value,
  fallback
) {
  const parsed =
    Number.parseInt(
      value,
      10
    );

  return (
    Number.isInteger(parsed) &&
    parsed > 0
  )
    ? parsed
    : fallback;
}

const USER_DAILY_QUESTION_LIMIT =
  readPositiveInteger(
    process.env
      .USER_DAILY_QUESTION_LIMIT,

    DEFAULT_USER_DAILY_QUESTION_LIMIT
  );

const DAILY_QUESTION_QUOTA_TIME_ZONE =
  String(
    process.env
      .DAILY_QUESTION_QUOTA_TIME_ZONE ||
      DEFAULT_DAILY_QUESTION_QUOTA_TIME_ZONE
  ).trim() ||
  DEFAULT_DAILY_QUESTION_QUOTA_TIME_ZONE;

module.exports = {
  DEFAULT_USER_DAILY_QUESTION_LIMIT,

  DEFAULT_DAILY_QUESTION_QUOTA_TIME_ZONE,

  USER_DAILY_QUESTION_LIMIT,

  DAILY_QUESTION_QUOTA_TIME_ZONE,

  readPositiveInteger,
};