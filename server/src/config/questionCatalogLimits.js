"use strict";

// Maximum documents returned by one Firestore mode scan. Read one extra
// document to detect an oversized catalog rather than silently truncating.
const raw = process.env.QUESTION_MODE_SCAN_LIMIT;
const QUESTION_MODE_SCAN_LIMIT = raw === undefined || raw === "" ? 5000 : Number(raw);
if (!Number.isSafeInteger(QUESTION_MODE_SCAN_LIMIT) ||
    QUESTION_MODE_SCAN_LIMIT < 100 || QUESTION_MODE_SCAN_LIMIT > 100000) {
  throw new Error("QUESTION_MODE_SCAN_LIMIT must be an integer between 100 and 100000.");
}

// Query filters cannot be used to trigger unbounded matching work.
const MAX_SETUP_FILTER_LENGTH = 120;
const MAX_SELECTED_TAGS = 30;

module.exports = {
  QUESTION_MODE_SCAN_LIMIT,
  MAX_SETUP_FILTER_LENGTH,
  MAX_SELECTED_TAGS,
};
