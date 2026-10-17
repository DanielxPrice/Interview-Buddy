const fs = require("fs");
const path = require("path");
const { buildQuestionMetadata } = require("../server/src/services/questionMetadataBuilder");

const questions = require("../server/seed/questions.json");
if (!Array.isArray(questions) || !questions.length) {
  throw new Error("Question seed dataset is empty.");
}
const snapshot = buildQuestionMetadata(questions);
const target = path.join(__dirname, "../src/data/questionMetadata.json");
fs.writeFileSync(target, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`Generated safe setup metadata from ${questions.length} seed questions.`);
