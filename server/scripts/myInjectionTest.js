// STAGE 1: grade ONE answer with the real AI.

require("dotenv").config();
// --- Part B: load the REAL grading code the app uses ---
const { generateEvaluation } = require("../src/services/providers/anthropicProvider");

// --- Part C: a fake interview question we control ---
const question = {
  id: "my-test-question",
  mode: "Theoretical Style",
  prompt: "Explain the difference between a process and a thread.",
  referenceAnswer:
    "A process has its own memory space. Threads share memory inside a process.",
  gradingCriteria: [
    { name: "Accuracy", weight: 70, description: "Correctly explains the difference." },
    { name: "Clarity", weight: 30, description: "Explanation is clear." },
  ],
};

// --- Part D: grade one answer and print the result ---
async function main() {
  const result = await generateEvaluation({
    question,
    candidateResponse: "I do not know the answer.",
    gradingCriteria: question.gradingCriteria,
  });

  console.log("Score:", result.score);
  console.log("Feedback:", result.feedback);
}

main().catch((error) => console.error("Something went wrong:", error.message));