// server/src/services/providers/anthropicProvider.js
//
// Anthropic-specific adapter for the common AI evaluation contract. No route
// or page imports the Anthropic SDK directly.

const Anthropic = require("@anthropic-ai/sdk");
const {
  formatRubric,
  normalizeEvaluation,
} = require("../evaluationContract");
const { getAiConfig } = require("../../config/aiConfig");

async function getAnthropicClient() {
  const config = await getAiConfig();

  return new Anthropic({
    apiKey: config.anthropicApiKey,
  });
}

function extractTextContent(aiResponse) {
  if (!Array.isArray(aiResponse?.content)) {
    return "";
  }

  return aiResponse.content
    .filter((block) => block?.type === "text" || typeof block?.text === "string")
    .map((block) => String(block.text || ""))
    .join("\n")
    .trim();
}

function parseJsonResponse(rawText) {
  const cleaned = String(rawText || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  return JSON.parse(cleaned);
}

async function generateEvaluation({
  question,
  candidateResponse,
  gradingCriteria,
}) {
  const rubricText = formatRubric(gradingCriteria);
  const evaluationInstructions = String(
    question.evaluationInstructions ||
      "Accept technically equivalent answers and alternative valid approaches. Do not require exact wording from the reference answer."
  ).trim();

  const prompt = `You are the answer-evaluation component for Interview Buddy.

Evaluate the candidate's response using ONLY the interview question, private reference answer, and weighted grading rubric below.

Interview mode: ${question.mode}
Topic: ${question.topic || "General"}
Difficulty: ${question.difficulty || "Unspecified"}

QUESTION
${question.prompt}

CANDIDATE RESPONSE
${candidateResponse}

PRIVATE REFERENCE ANSWER
${question.referenceAnswer}

WEIGHTED GRADING RUBRIC (TOTAL 100 POINTS)
${rubricText}

QUESTION-SPECIFIC EVALUATION INSTRUCTIONS
${evaluationInstructions}

GRADING REQUIREMENTS
- Grade each criterion independently and award between 0 and that criterion's point value.
- The final total score is calculated by server code from the awarded criterion points.
- Accept equivalent correct solutions, terminology, examples, or algorithms when they satisfy the rubric.
- Do not invent requirements that are not present in the question or rubric.
- Feedback must be specific to the candidate response and useful for interview practice.
- For code questions, focus on correctness, edge cases, complexity, and explanation only when the rubric asks for them.
- For theoretical questions, focus on technical accuracy, completeness, examples, and clarity only when the rubric asks for them.

Respond ONLY with valid JSON in this exact structure:
{
  "feedback": "One concise overall evaluation.",
  "strengths": ["specific strength"],
  "weaknesses": ["specific weakness"],
  "suggestions": ["specific improvement"],
  "criterionResults": [
    {
      "name": "criterion name in the same order as the rubric",
      "awardedPoints": 0,
      "feedback": "criterion-specific explanation"
    }
  ]
}`;

  const anthropic = await getAnthropicClient();
  const aiResponse = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
    max_tokens: 1200,
    temperature: 0,
    messages: [{ role: "user", content: prompt }],
  });

  try {
    const parsed = parseJsonResponse(extractTextContent(aiResponse));
    return normalizeEvaluation(parsed, gradingCriteria);
  } catch (error) {
    const wrapped = new Error(
      "Anthropic response did not match the expected evaluation shape."
    );
    wrapped.cause = error;
    wrapped.statusCode = 502;
    throw wrapped;
  }
}

module.exports = { generateEvaluation };
