
# SCRUM-86 — Firestore Index Requirements and Data Integrity

## 1. Objective

Document Firestore index requirements for the implemented
database queries and verify that core read and write
operations have automated integrity coverage.

This task focuses on existing session, user, question,
history, results, and ranking functionality.

## 2. Composite Index Requirements

### Index 1 — User Session History

Collection: sessions

Fields:
- userId: ASCENDING
- createdAt: DESCENDING

Supported operations:
- listByUser()
- getSessionPage() without completed-status filtering

Expected behavior:
Only the specified user's sessions are retrieved,
ordered by creation time, with bounded result sizes.

### Index 2 — Completed Session History

Collection: sessions

Fields:
- userId: ASCENDING
- status: ASCENDING
- completedAt: DESCENDING

Supported operations:
- listCompletedByUser()
- getSessionPage() with status="completed"

Expected behavior:
Only completed sessions belonging to the specified
user are returned, ordered by completion time.

Both indexes are defined in firestore.indexes.json.
firebase.json references this configuration file.

## 3. Other Query Requirements

User lookup:
- Collection: users
- Filter: usernameLower equality
- Requirement: Automatic single-field index

Question lookup:
- Collection: questions
- Filter: mode equality
- Requirement: Automatic single-field index

Document ID lookups:
- Sessions, users, responses, usage, and active slots
- No additional composite index required for direct
  document lookup.

Global Leaderboard:
- Current implementation reads projected user profiles.
- Ranking order is calculated in application memory.
- No composite Firestore index is currently used for
  this leaderboard operation.
- An index alone cannot replace the existing full scan.

## 4. Automated Integrity Coverage

| Area | Existing Test File |
|---|---|
| Completed History reads | FirestoreSessionRepository.completed.test.js |
| Pagination and cursor validation | FirestoreSessionRepository.limits.test.js |
| Session creation and active slots | FirestoreSessionRepository.activeSlots.test.js |
| Quiz response persistence | FirestoreSessionRepository.results.test.js |
| Session completion integrity | FirestoreSessionRepository.completion.test.js |
| Ranking transaction integrity | FirestoreSessionRepository.ranking.test.js |
| User profile integrity | FirestoreUserRepository.test.js |
| Index and query contract | FirestoreSessionRepository.indexIntegrity.test.js |

The existing Firestore Emulator integration suite also
covers real-SDK reads, writes, ownership isolation,
and completed-session queries.

## 5. SCRUM-86 New Test Coverage

SCRUM-86 introduces nine new automated tests:

1. Firebase index configuration reference.
2. Composite-index structure and uniqueness.
3. Ordinary History query and index compatibility.
4. Completed History query and index compatibility.
5. Paginated ordinary History index compatibility.
6. Paginated completed History index compatibility.
7. Rejection of a cursor with an incompatible status.
8. Rejection of a deleted session cursor.
9. Propagation of Firestore query failures.

## 6. Verification Limitations

Jest tests using mocked Firestore dependencies verify
repository behavior under controlled test conditions.

They do not independently prove that the composite
indexes have been deployed in a particular Firebase
project.

Firestore Emulator integration tests provide stronger
verification of actual Firestore SDK behavior but do
not replace production deployment verification.

The Firebase Admin SDK bypasses Firestore security
rules. Repository ownership, direct-client rules,
and authenticated API authorization are distinct
testing responsibilities.

## 7. Acceptance Criteria

- Required Firestore indexes are documented.
- Current indexed query shapes are verified.
- Automated checks cover core read and write operations.
- Existing session ownership and transaction protections
  remain covered by regression tests.
- Targeted and complete backend regression tests pass.
- No production database modification is required.
