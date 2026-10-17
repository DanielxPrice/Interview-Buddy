# Interview Buddy AI Evaluation Integration

This merged version brings the AI answer-evaluation behavior from `test.zip` into the current main application while keeping the main branch's provider and repository abstractions.

## Request flow

```text
InterviewSessionPage
  -> src/services/aiService.js
  -> POST /api/evaluate
  -> QuestionRepository.findById(questionId)
  -> server/src/services/aiService.js
  -> configured AI provider adapter
  -> validated weighted evaluation
  -> EvaluationRepository.saveEvaluation(...)
  -> React feedback/results
```

The route does not import Firebase or an AI SDK directly. Firestore-specific behavior stays in repository adapters, and Anthropic-specific behavior stays in `server/src/services/providers/anthropicProvider.js`.

Quiz Style continues to use deterministic grading through `POST /api/questions/:questionId/check`.

## Private grading data

For Code Style and Theoretical Style questions, the React client sends only the public question ID, the candidate response, and optional session metadata. The backend reloads the full question through `QuestionRepository`, so `referenceAnswer`, `gradingCriteria`, and `evaluationInstructions` remain server-side.

Each AI-graded question requires:

```json
{
  "id": "code-example-001",
  "mode": "Code Style",
  "prompt": "Question shown to the candidate",
  "referenceAnswer": "Private grading reference",
  "gradingCriteria": [
    {
      "name": "Correctness",
      "weight": 60,
      "description": "What earns these points"
    },
    {
      "name": "Explanation",
      "weight": 40,
      "description": "What earns these points"
    }
  ],
  "evaluationInstructions": "Optional question-specific guidance"
}
```

Rubric requirements are validated both before seeding and before an AI request is made. Weights must total 100. The model awards points per criterion, and server code computes the final score from those awarded points instead of trusting a model-supplied total.

## Structured response

The provider abstraction returns:

```json
{
  "score": 85,
  "feedback": "Overall response-specific feedback",
  "strengths": ["Specific strength"],
  "weaknesses": ["Specific weakness"],
  "suggestions": ["Specific improvement"],
  "criterionResults": [
    {
      "name": "Correctness",
      "awardedPoints": 52,
      "maxPoints": 60,
      "feedback": "Criterion-specific feedback"
    }
  ]
}
```

## Environment variables

Copy `server/.env.example` to `server/.env` and configure Firebase plus the selected provider:

```env
PORT=5001
FIREBASE_PROJECT_ID=your-firebase-project-id
CLIENT_ORIGIN=http://localhost:3000
AI_PROVIDER=anthropic
ANTHROPIC_MODEL=claude-sonnet-4-6
```

Do not place the provider key in a React `REACT_APP_*` variable.

The React client only needs:

```env
REACT_APP_API_BASE_URL=http://localhost:5001/api
```

## Seed data

The current main branch's 30-question dataset is preserved. All 20 Code/Theoretical questions now include the private grading fields required by AI evaluation; the 10 Quiz questions retain deterministic answer keys.

```bash
cd server
npm install
npm run seed
npm start
```

Run the React client separately from the repository root:

```bash
npm install
npm start
```

## Provider replacement

To add another provider later, implement the contract in `server/src/services/providers/aiProvider.interface.js`, register it in `server/src/services/aiService.js`, and switch `AI_PROVIDER`. The Express route and React call sites do not need provider-specific changes.
