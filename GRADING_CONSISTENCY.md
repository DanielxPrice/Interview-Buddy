# Grading Consistency

How Interview Buddy reduces score variance when the AI grades similar answers.

- Code: `server/src/services/evaluationContract.js` (`SCORE_BANDS`, `snapToBand`, `allowedPoints`, `formatRubric`, `normalizeEvaluation`)
- Prompt: `server/src/services/providers/anthropicProvider.js`
- Tests: `server/src/services/gradingConsistency.test.js`

Applies to AI-graded modes (Code Style and Theoretical Style). Quiz Style is graded by exact answer matching and already gives the same score every time.

## The problem

Two candidates who give answers with the same substance should get the same score. Before this change, they often did not. The model could award any number of points per criterion, so two nearly identical answers might get 41/70 and 46/70 on the same criterion.

Because the session score feeds ELO and the leaderboard, this randomness turned into unfair rating differences between users.

## Where the variance came from

| Source | Why it caused variance |
| --- | --- |
| Continuous points | The model could choose any value from 0 to the criterion weight, so small judgment differences changed the score. |
| Undefined partial credit | The prompt said "award between 0 and that criterion's point value" but never said what 50% vs 70% means, so the model judged it fresh each time. |
| No instruction about equivalent answers | Nothing told the model to ignore length, wording or formatting when the substance is the same. |

## Changes

### 1. Score bands (server side)

Each criterion can only score a multiple of 10% of its weight:

```
SCORE_BANDS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]
```

`normalizeEvaluation` passes every criterion's points through `snapToBand`, which rounds them to the nearest band.

| Criterion weight | Allowed points |
| --- | --- |
| 70 | 0, 7, 14, 21, 28, 35, 42, 49, 56, 63, 70 |
| 15 | 0, 1.5, 3, 4.5, 6, 7.5, 9, 10.5, 12, 13.5, 15 |
| 10 | 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 |
| 5 | 0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5 |

Rules:

- **Nearest band wins.** 40, 41 and 44 out of 70 all become 42 (60%).
- **Exact ties round up.** 30/40 is exactly 75%, halfway between 70% and 80%, so it becomes 32 (80%). Rounding up keeps the rule predictable and gives the candidate the benefit of the doubt.
- **Float noise is ignored.** Values within `1e-9` are treated as equal, so a tie stored as 0.7499999 still rounds up.
- **Validation runs first.** Points below 0 or above the weight are still rejected with an error. They are never quietly snapped into range, because that would hide a grading bug.
- **The total is still calculated by the server** from the snapped criterion points, not taken from the model.

### 2. Bands in the prompt

The model is now told which values it may use and what each level means, so it picks a band itself and snapping rarely has to change anything.

`formatRubric` lists the allowed values on every rubric line:

```
1. Core correctness (70 points; allowed: 0, 7, 14, 21, 28, 35, 42, 49, 56, 63, 70): ...
```

The `GRADING REQUIREMENTS` section of the prompt defines each level:

| Level | Meaning |
| --- | --- |
| 100% | Fully meets the criterion with no meaningful gaps. |
| 80–90% | Meets the criterion with minor gaps or imprecision. |
| 50–70% | Partly meets the criterion; some key points are missing or incorrect. |
| 10–40% | Shows only minimal relevant understanding for this criterion. |
| 0% | Missing, irrelevant, or incorrect for this criterion. |

The prompt also says: *"Responses with the same technical substance must receive the same points, regardless of length, wording, tone, or formatting. Do not reward length or penalize brevity on its own."*

### Settings that already helped

These were in place before this change and are kept:

- **Temperature 0.** The model picks its most likely output instead of sampling randomly.
- **Server-calculated total.** The final score is the sum of criterion points calculated by the server. A score the model writes itself is ignored.
- **Strict response checks.** Criterion names must match the rubric in order, and points must be real numbers in range, or the evaluation is rejected.

## Why 10% bands

| Option | Consistency | Detail | Size of one band flip on a 70-point criterion |
| --- | --- | --- | --- |
| 25% bands (5 levels) | Higher | Low | 17.5 points |
| **10% bands (11 levels)** | Good | Good | **7 points** |
| No bands | Lowest | Highest | Any amount |

Bands only help if the model lands in the same band. A borderline answer can still flip to the next band. With 25% bands, that flip is large (17.5 points). Because ELO adds up over many sessions, smaller, more frequent flips are fairer than rare large ones, so 10% bands were chosen.

To change the bands, edit `SCORE_BANDS` in `evaluationContract.js`. `allowedPoints`, the prompt and snapping all follow it automatically. Update the expected numbers in the tests afterward.

## Impact on ELO

ELO uses the session score: `newElo = R + 32 × (score / 100 − expected)`. Each session score point is worth **0.32 ELO** at any rating.

| Session score swing | ELO swing |
| --- | --- |
| 3 points | about 1 |
| 10 points | about 3 |
| 25 points | about 8 |

With 10% bands, one band flip on a 70-point criterion moves that question by 7 points. In a 5-question session, that is 1.4 session points, or **under 0.5 ELO**.

**The band wording affects who gains ELO.** At a rating of 1000, a 50% session score is break-even. The 50–70% level ("partly meets the criterion") is therefore what an average performance means. Making the level descriptions stricter would make most users slowly lose ELO; making them more lenient would make most users gain it. Any change to these descriptions should be reviewed together with the ELO policy.

## Known limits

- **The model still decides the band.** Bands remove small differences but cannot fix a model that judges an answer differently. Borderline answers can still flip one band.
- **Model version.** The model can be changed with the `ANTHROPIC_MODEL` environment variable (default `claude-sonnet-4-6`). Different environments using different models may grade differently, and a model upgrade can shift scores. Keep the model the same across environments that write ranked scores.
- **Prompt and rubric changes.** Editing the prompt, a rubric's descriptions or its weights changes how answers are graded. Scores from before and after such a change are not directly comparable.
- **Formatting is not normalized.** Two answers that differ only in whitespace or line endings still produce slightly different prompts. A possible follow-up is to normalize line endings, trailing spaces and extra blank lines before grading.

## Tests

`server/src/services/gradingConsistency.test.js` (16 tests) covers:

| Group | Scenarios |
| --- | --- |
| Score bands | Similar raw points snap to the same value; values on a band stay the same; exact ties round up; 0 and full points are unchanged; every snapped value is an allowed value |
| Similar answers | Two slightly different raw evaluations of the same answer get the same score; clearly different answers still score differently; out-of-range points are rejected |
| Prompt and settings | Temperature is 0; the prompt lists allowed values, defines each level and includes the same-substance rule; in-between points are snapped end to end |
| ELO | Two sessions with similar answers get the same session score and the same ELO change |

The model itself is mocked, so the tests check the parts Interview Buddy controls, not the model's judgment.

Run them with:

```bash
cd server
npx jest gradingConsistency
```