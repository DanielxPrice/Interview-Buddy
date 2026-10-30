# Session Scoring

How Interview Buddy turns per-question and per-step scores into one session score.

- Code: `server/src/services/sessionScoreAggregator.js`
- Tests: `server/src/services/sessionScoreAggregator.test.js`
- Used by: `FirestoreSessionRepository.finalizeSessionWithResults` when a session is completed

The server is the source of truth. The session score is calculated once, when the session is finalized, and saved on the session as `result`.

## Terms

| Term | Meaning |
| --- | --- |
| Step | One rubric criterion on an AI-graded question (`evaluation.criterionResults[]`), with `awardedPoints` and `maxPoints`. |
| Question score | A 0–100 score for one answered question (`evaluation.score`). |
| Session score | The single 0–100 whole number shown for the whole session. |

## Aggregation rules

1. **Scale.** Every question score is on a 0–100 scale.
2. **Question score comes from `evaluation.score`** when it is present. This is the normal case: Quiz answers are saved as 100 (correct) or 0 (incorrect), and AI-graded answers are saved with a score already summed from their rubric steps.
3. **Fallback to steps.** If `evaluation.score` is missing, the question score is derived from its steps:
   `sum(awardedPoints) / sum(maxPoints) × 100`, rounded to one decimal place.
   This works even if step weights do not total 100. A saved score of `0` is a real score, not a missing one.
4. **Weights.** Each question counts once (weight 1). A response may set an optional positive `weight` to count more or less. No question currently sets a weight, so today every question counts equally.
5. **Session score** = weighted mean of question scores, rounded to the nearest whole number (exact halves round up, e.g. 84.5 → 85), kept within 0–100. Floating point noise is removed before rounding so a true .5 always rounds up.
6. **Empty session.** A session with no answered questions scores 0.
7. **Invalid data rejects the whole calculation.** Nothing is skipped or clamped. Invalid means any of:
   - score outside 0–100, not a number, `NaN` or infinite
   - no `evaluation`, or neither a score nor steps
   - a step with `maxPoints` ≤ 0, or `awardedPoints` outside 0–`maxPoints`
   - a weight that is not a positive number
   - a response whose `mode` does not match the session's mode (checked in the repository)

   The repository turns this into a 409 with code `INVALID_SCORING_DATA`, and the session stays `active` so it can be retried.

## Result shape

```json
{
  "score": 85,
  "questionsAnswered": 2,
  "totalScore": 170
}
```

| Field | Meaning |
| --- | --- |
| `score` | Session score (rule 5). |
| `questionsAnswered` | Number of responses counted. |
| `totalScore` | Unweighted sum of question scores. Kept so results saved before this change still read the same. |

This shape is unchanged from the previous inline calculation, so existing sessions and the client need no migration.

## Examples

| Question scores | Weights | Session score |
| --- | --- | --- |
| 100, 70 | — | 85 |
| 100, 0, 100, 100 | — | 75 |
| 85, 84 | — | 85 (84.5 rounds up) |
| 100, 100, 0 | — | 67 (66.67) |
| 100, 40 | 3, 1 | 85 ((300 + 40) / 4) |
| steps 30/40 + 20/60 → 50, then 90 | — | 70 |
| none | — | 0 |
| 90, 120 | — | rejected (120 is out of range) |

## Running the tests

```bash
cd server
npx jest sessionScoreAggregator
```