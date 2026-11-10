
# SCRUM-111 - Proposed ELO Rating Algorithm

**Owner:** Daniel - Application / Integration  
**Status:** Implementation proposed; numerical parameters require team approval before live integration.  
**Related tickets:** SCRUM-112 (Daniel), SCRUM-117 (Hoonam), SCRUM-188 and SCRUM-236 (Daniel).

## Purpose and existing system

Interview Buddy currently persists points, rankedSessions, and averageScore for eligible completed sessions. These fields are **not** ELO and must not be renamed or interpreted as ELO. The ELO calculator is a separate, pure application-layer function.

This design adapts the expected-performance term of traditional Elo to an interview setting. Since users are not competing head-to-head, each session is compared with a fixed reference benchmark instead of another user. It is therefore a **performance-based Elo-inspired rating**, not a head-to-head Elo match calculation.

## Proposed parameters

| Parameter | Proposed value | Meaning |
| --- | ---: | --- |
| Initial ELO | 1000 | Starting rating for an account with no saved ELO |
| Benchmark ELO | 1000 | Rating of the fixed reference performance |
| K-factor | 32 | Maximum absolute rating adjustment before rounding |
| Rating scale | 400 | Elo logistic curve scale |
| Minimum ELO | 0 | Lower bound |
| Session score | Integer 0-100 | Authoritative result calculated by the server |

**These values are proposed by the implementation; the team's project documents do not specify official numeric values.**

## Formula

```text
expected = 1 / (1 + 10 ^ ((benchmarkElo - previousElo) / ratingScale))
actual = sessionScore / 100
newElo = round(max(0, previousElo + kFactor * (actual - expected)))
eloChange = newElo - previousElo
```

A 100-point session is treated as full performance (1.0), a 50-point session as partial performance (0.5), and a 0-point session as zero performance. Both increases and decreases are possible. Ratings are stored as whole numbers.

## Examples

| Previous ELO | Session score | New ELO | Change |
| ---: | ---: | ---: | ---: |
| Missing | 100 | 1016 | +16 |
| 1000 | 0 | 984 | -16 |
| 1000 | 25 | 992 | -8 |
| 1000 | 50 | 1000 | 0 |
| 1000 | 75 | 1008 | +8 |
| 1000 | 100 | 1016 | +16 |
| 1200 | 50 | 1192 | -8 |
| 1200 | 100 | 1208 | +8 |

## API and persistence boundaries

- **SCRUM-111 (Daniel):** `server/src/services/eloRating.js` implements `calculateEloUpdate({ currentElo, sessionScore })`; no database access.
- **SCRUM-112 (Daniel):** Call the function only when an eligible, fully graded session completes, using the authoritative server result. Preserve existing prevention of double-ranking a session.
- **SCRUM-117 (Hoonam):** Agree on a persistent `ranking.elo` field and a storage contract. Apply updates within the existing safe completion transaction or an equivalent concurrency-safe mechanism. Handle old profiles without ELO and avoid overwriting existing points data.
- **UI ownership (Andrew):** Display ELO only when a real value is returned by the backend. Do not infer ELO from points.

Suggested completed-session result fields for team approval: `eloBefore`, `eloAfter`, and `eloChange`. These fields are **not** persisted by SCRUM-111.

## Validation and limitations

- Missing/null prior ELO is initialized to 1000; a saved zero is preserved.
- A session score must be a whole number from 0 to 100, matching the current authoritative session-result contract.
- An existing rating must be a nonnegative safe integer.
- Invalid inputs throw `INVALID_ELO_INPUT` and do not change any stored data.
- The function is deterministic and has no database, network, or time dependencies.
- Re-running the function with the same prior rating calculates the same result; **idempotent persistence is a separate responsibility** for SCRUM-112/117.
- Eligibility and completion status are checked in the session-completion workflow, not in the calculator.

## Tests

From the `server` directory:

```powershell
npm test -- --runInBand --watchAll=false --runTestsByPath src/services/eloRating.test.js --verbose
```

No existing points, leaderboard, session repository, or frontend files are changed as part of SCRUM-111.
