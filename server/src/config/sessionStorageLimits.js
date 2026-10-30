"use strict";

const { DAILY_QUESTION_QUOTA_TIME_ZONE } = require("./questionQuota");

function readBoundedInt(name, fallback, maximum) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1 || n > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}.`);
  }
  return n;
}

const SESSION_DAILY_CREATE_LIMIT = readBoundedInt("SESSION_DAILY_CREATE_LIMIT", 30, 1000);
const SESSION_HISTORY_PAGE_MAX = 50;
const SESSION_HISTORY_PAGE_DEFAULT = 25;
const SESSION_STORAGE_TIME_ZONE = DAILY_QUESTION_QUOTA_TIME_ZONE;
// Bounded fixed slots make concurrent active-session admission atomic.
const SESSION_ACTIVE_LIMIT = readBoundedInt("SESSION_ACTIVE_LIMIT", 5, 10);
// A hard maximum lifetime; finishing early immediately releases the slot.
const SESSION_ACTIVE_LIFETIME_HOURS = readBoundedInt("SESSION_ACTIVE_LIFETIME_HOURS", 168, 720);

module.exports = {
  SESSION_DAILY_CREATE_LIMIT,
  SESSION_HISTORY_PAGE_MAX,
  SESSION_HISTORY_PAGE_DEFAULT,
  SESSION_STORAGE_TIME_ZONE,
  SESSION_ACTIVE_LIMIT,
  SESSION_ACTIVE_LIFETIME_HOURS,
  readBoundedInt,
};
