// server/src/services/providers/aiProvider.interface.js
//
// Documentation-only contract for AI provider adapters. Every provider keeps
// its SDK, prompt construction, and provider-specific response parsing inside
// its own module, while the rest of the app sees one common evaluation shape.

module.exports = {
  CONTRACT: `
    Every AI provider module must export:

    async function generateEvaluation({ question, candidateResponse, gradingCriteria })

    Input:
      - question: server-side question object, including private grading fields
      - candidateResponse: string
      - gradingCriteria: weighted rubric entries

    Output:
      - score: number (0-100), calculated from awarded rubric points
      - feedback: string
      - strengths: string[]
      - weaknesses: string[]
      - suggestions: string[]
      - criterionResults: [{ name, awardedPoints, maxPoints, feedback }]

    Providers are responsible for:
      - Building their provider-specific prompt/request
      - Parsing their provider-specific response format
      - Returning the shared structured evaluation shape
      - Never exposing provider-specific SDK response objects to callers
  `,
};
