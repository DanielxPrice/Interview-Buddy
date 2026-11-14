# Code Style Evaluation

How Interview Buddy grades readability and code style on Code Style questions.

- Rubric: `server/src/services/codeStyleRubric.js` (`CODE_STYLE_RUBRIC`)
- Apply script: `server/scripts/applyCodeStyleRubric.js` (`npm run apply-code-style-rubric`)
- Prompt: `server/src/services/providers/anthropicProvider.js`
- Tests: `server/src/services/codeStyleEvaluation.test.js`
- Related: `GRADING_CONSISTENCY.md` (score bands)

## The problem

Code Style questions were graded only on whether the code worked. Readability was not graded anywhere:

- **No criterion covered it.** The rubric had correctness, edge cases, "efficiency and implementation quality", and explanation. "Implementation quality" only described complexity, data structures and state management.
- **The prompt told the model to skip it.** It said to focus on "correctness, edge cases, complexity, and explanation" and to prioritize logic errors "over minor style issues".

So two correct answers, one clean and one hard to read, scored the same. In a real interview, readability matters.

## Rubric change

All 500 Code Style questions use one shared rubric.

| Criterion | Before | After |
| --- | --- | --- |
| Core correctness | 70 | **60** |
| Edge cases and robustness | 15 | 15 |
| Efficiency and implementation quality | 10 | renamed **Efficiency**, 10 |
| Readability and code style | — | **10 (new)** |
| Explanation | 5 | 5 |
| **Total** | 100 | 100 |

### Why these weights

- **10 points for style** is enough to matter, but correctness still decides most of the score. Style can cost at most 10 points per question, or about 3 ELO per session.
- **The 10 points come from correctness** because the other criteria are already small. Edge cases (15) would drop too low, and efficiency and explanation are already 10 and 5.
- **Efficiency was narrowed** to complexity and data structures only, so a readability problem isn't penalized twice.

The weights are a team decision. To change them, edit `CODE_STYLE_RUBRIC` and see "Updating the rubric" below.

## The style criterion

> Award for code that is easy to read and maintain: clear, descriptive names; sensible structure and decomposition; no dead, commented-out or needlessly duplicated code; consistent formatting and indentation; and idiomatic use of the language. Accept any consistent convention (for example camelCase or snake_case) and do not require comments; do not award points for comments that only restate the code. Style cannot make up for missing logic: if the code does not genuinely attempt the task (for example an empty or placeholder function), award 0 for this criterion.

### Guardrails

| Guardrail | Why |
| --- | --- |
| **Rewards specific things**: names, structure, no dead or duplicated code, consistent formatting, idiomatic code | "Good style" alone is vague and would be graded inconsistently. |
| **Any consistent convention is fine** (camelCase or snake_case) | Candidates use different languages and style guides. Consistency is what matters. |
| **Comments aren't required, and padding isn't rewarded** | Otherwise candidates could earn points by adding comments that restate the code. |
| **Code that doesn't attempt the task gets 0 for style** | Without this, a neatly formatted empty function would earn style points. |
| **No double penalties** | Correctness says not to deduct for style issues, Efficiency says not to deduct for naming or formatting, and Explanation says missing prose must not reduce readability points. |

## Prompt changes

In `anthropicProvider.js`:

| Before | After |
| --- | --- |
| Focus on "correctness, edge cases, complexity, and explanation" | Adds "readability and code style" |
| — | Judge style only from the submitted code: naming, structure, dead or duplicated code, formatting, idiomatic use |
| — | Accept any consistent convention; don't require comments or reward comments that restate the code |
| — | Style never makes up for incorrect logic, and style issues never reduce other criteria; 0 for style if the code doesn't attempt the task |
| Same substance gets the same points "regardless of … formatting" | Adds an exception for the readability criterion, which is meant to judge how the code is written |
| Prioritize logic errors "over minor style issues" | Logic errors still come first in the overall feedback, but style issues go in the readability criterion's feedback with a concrete fix |

The formatting exception is needed because of the grading consistency work. That rule says formatting must not change the score, which would otherwise contradict the new style criterion.

## Examples

Points are listed as correctness / edge cases / efficiency / style / explanation.

| Answer | Points | Score |
| --- | --- | --- |
| Correct and clean | 60 / 15 / 10 / 10 / 5 | 100 |
| Correct but messy | 60 / 15 / 10 / 3 / 5 | 93 |
| Correct, worst possible style | 60 / 15 / 10 / 0 / 5 | 90 |
| Tidy but mostly broken | 12 / 3 / 5 / 9 / 5 | 34 |
| Empty or placeholder function | 0 / 0 / 0 / 0 / 0 | 0 |

Style points follow the 10% bands from `GRADING_CONSISTENCY.md`, so a 10-point criterion moves in whole points (0–10).

## Impact on ELO

ELO uses the session score: `newElo = R + 32 × (score / 100 − expected)`, so each session score point is worth about 0.32 ELO.

- **Clean, correct code:** no change. It still scores 100.
- **Correct but messy code:** loses up to 10 points per question, which is about 3 ELO per session at worst. Users who write hard-to-read code slowly fall behind users who write clean code, which is the goal.
- **The overall average should barely move.** Points moved between criteria; the total is still 100. ELO breaks even at 50%, so most users' ratings shouldn't drift as long as style is graded about as generously as correctness was.
- **No ELO code changes.** `eloRating.js` still receives a whole-number session score from 0 to 100.
- **Before vs after:** Code Style sessions graded before and after this change used different rubrics, so their scores aren't directly comparable. Ratings don't need resetting, because ELO adds up over time.

## Updating the rubric

1. Edit `CODE_STYLE_RUBRIC` in `server/src/services/codeStyleRubric.js`. The weights must total 100.
2. From `/server`, run `npm run apply-code-style-rubric`. This copies the rubric into every Code Style question in `server/seed/questions.json`, checks it with the same `validateRubric` the server uses, and only touches Code Style questions. Running it twice is safe; the second run reports "0 changed".
3. Run `node scripts/validateQuestionSeed.js` and `npx jest`. `codeStyleEvaluation.test.js` checks that the seed matches the rubric.
4. **To make the change live, run `npm run seed`.** The app reads questions from Firestore, not from the seed file, so the new rubric only takes effect after reseeding.

## Known limits

- **Style is partly subjective.** The model decides what counts as a clear name or a sensible structure. The guardrails and score bands reduce variance but can't remove it.
- **Only Code Style questions changed.** Theoretical and Quiz questions are unchanged.
- **Language-specific style guides aren't enforced.** The criterion rewards consistency and readability, not a particular guide like PEP 8 or Airbnb.

## Tests

`server/src/services/codeStyleEvaluation.test.js` (25 tests):

| Group | Scenarios |
| --- | --- |
| Rubric | Weights are 60/15/10/10/5 and total 100; it passes `validateRubric`; the style criterion lists what good style is, accepts any convention, doesn't require comments, and gives 0 to code that doesn't attempt the task; other criteria don't penalize style; the rubric is frozen |
| Seed data | Every Code Style question uses the rubric; other modes don't get the style criterion; rerunning the script changes nothing; the script only touches Code Style questions |
| Prompt | Lists the style criterion with allowed points 0–10; tells the model to grade style; includes the guardrails and the formatting exception; no longer says "over minor style issues" |
| Style-related scoring | Clean and correct scores 100; messy and correct loses only the style points; style costs at most 10; tidy but broken scores far below messy but correct; a placeholder scores 0; style above 10 is rejected; in-between style points snap to a whole point |
| ELO | Clean code gets a better ELO change than messy code with the same logic; style costs at most about 3 ELO per session |

Run them with:

```bash
cd server
npx jest codeStyleEvaluation
```