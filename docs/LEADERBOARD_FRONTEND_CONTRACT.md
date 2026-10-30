# Leaderboard & Friends UI — Future API Contract

This is a **frontend-only** integration. The React interface no longer imports
`src/data/mockLeaderboard.js` or `src/data/mockFriends.js` (both removed).
No backend routes, Firestore collections, scoring logic, or friend-request
persistence have been added in this change.

Firestore is locked to direct client access (`firestore.rules` denies browser
reads and writes). As with the existing History and Settings pages, the UI
must call authenticated Express endpoints. All requests send the signed-in
Firebase user's ID token in `Authorization: Bearer <token>` and use
`REACT_APP_API_BASE_URL` (default `http://localhost:5001/api`).

## Planned reads (not currently implemented)

| Method and path | Expected JSON response |
| --- | --- |
| `GET /api/leaderboard/global` | `{ "rankings": [{ "uid": "user1", "username": "alex", "rank": 1, "elo": 1550 }] }` |
| `GET /api/leaderboard/friends` | `{ "rankings": [{ "uid": "user2", "username": "sam", "rank": 10, "elo": 1200 }] }` |
| `GET /api/leaderboard/me` | `{ "ranking": { "uid": "user1", "username": "alex", "rank": 1, "elo": 1550 } }` or `{ "ranking": null }` |

Successful empty lists must return HTTP **200** with `{ "rankings": [] }`.
The backend should derive the user for `/me` and `/friends` from the validated
Firebase token, not from a client-supplied user ID. `GET /api/leaderboard/friends` should only
return the authenticated user's accepted friends, including stable user IDs
for removal. All rank/ELO values must come from persisted records; missing
values may be `null` and will display as `—`.

## Planned friend actions (not currently implemented)

- `POST /api/friends/requests` with JSON `{ "username": "alex" }`
  submits a request. An accepted response means **request sent**, not that the
  target has accepted or should immediately appear in the friends leaderboard.
- `DELETE /api/friends/:uid` removes an existing accepted friendship, with
  the target identified by its stable user UID.

The UI does not optimistically add/remove rows. It refetches the friends list
after a successful request and does not display successful outcomes for failed
writes. The Add Friend form is disabled when the friends data endpoint is
unavailable.

## Display states

- **Loading**: authenticated request pending.
- **Unavailable**: HTTP 404/501 (endpoints do not yet exist); no sample users.
- **Empty**: successful HTTP 200 with an empty `rankings` array or a `null`
  personal ranking; displays no available data.
- **Error**: connection, authorization, or invalid response; no mock fallback.

Backend developers can implement these route contracts in a later sprint
without revising the page layout. No new backend work is included in this PR.

## ELO rank badge display (frontend-only)

The decorative star on the Your Standing card has been replaced with a mascot
badge chosen from the **real** `ranking.elo` value returned by the personal
ranking endpoint. Badge images are existing assets under `public/`; there are
no additional Firestore reads or backend endpoints. If the personal ranking
has not loaded, is missing, or has no valid ELO, a neutral `?` placeholder is
shown instead of implying the user has earned a specific rank.

The **badge tier cutoffs are provisional**, since the backend and project
materials do not yet define an official ELO-to-tier mapping. Change only the
`minElo` values in `src/utils/eloRankBadge.js` when the team establishes the
final tiers. These classifications are display-only and do not set or alter
users' ELO values, or their leaderboard position.

| ELO from | Display badge |
| ---: | --- |
| 0 | Janitor |
| 400 | Unpaid Intern |
| 700 | Paid Intern |
| 1000 | Graduate |
| 1300 | Junior Developer |
| 1600 | Senior Developer |
| 1900 | Meta Keynote |
| 2200 | NVIDIA Keynote |
| 2500 | Tech CEO |
