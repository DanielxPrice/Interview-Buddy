# Account setup and deletion fixes

## Behavior

- Email/password registration authenticates with Firebase first and saves the chosen name in the Auth display name. Unverified signups no longer create a Firestore application profile. The Firebase Auth identity must exist to send an email verification link; it is not a completed application account.
- After verification, loading the profile creates the deferred profile. A username claimed in the meantime returns the user to username onboarding instead of blocking login. The verification screen appears before the incomplete-profile redirect, preventing a login/verification loop.
- The profile API independently rejects unverified users. Existing profiles are returned without resetting settings, ranking, or roles. The administrative sync skips unverified/disabled missing profiles and accounts marked for deletion.
- Profile creation and rename reserve a case-insensitive username in a Firestore transaction. `usernames/{sha256(normalizedUsername)}` stores its owner UID, avoiding invalid document paths for existing usernames. The transaction protects against concurrent claims; existing profiles are still checked for legacy ownership. Rename releases the previous reservation. Legacy profiles without a stored `uid` use the document ID for ownership checks.
- Profile creation refreshes the ID token after provider linking so the server sees current authentication state.
- Canceling Google setup deletes only an identity reported as new by that popup. Existing logins with missing profiles, including resumed setups after a reload, are signed out safely.
- Auth-context profile loads ignore stale results after a subsequent auth-state change, preventing a deleted/signed-out user's profile from reappearing.

## Deletion and recovery

Account deletion requires the existing confirmation and recent reauthentication. It marks the profile as deleting before removing owned sessions and nested user data. Normal practice admission and profile creation reject accounts with that marker. Cleanup errors retain the marker and Auth identity for a retry. An already-missing Auth identity is treated as an idempotent deletion.

After Auth deletion, the service removes username reservations and recursively removes the profile. Final cleanup failures still return `account-deletion-partial`, rather than falsely reporting success.

The new `cleanupDeletedAccount` Firebase Auth deletion function independently removes owned sessions (including responses/evaluation attempts), username reservations, and the complete user subtree (usage, rate limits, active session slots, and future descendants). Its failure policy enables retries. This also covers client SDK rollback/cancellation and individual console/admin deletions. Reservation deletion rereads ownership inside a transaction so a delayed cleanup cannot remove a name since claimed by another user.

Auth and Firestore cannot commit atomically. The deletion trigger provides eventual cleanup after a partial failure; monitor failed function invocations and use the reconciliation command below if retries are exhausted. Bulk Admin SDK `deleteUsers` does not emit individual Auth deletion events; use individual deletion or reconciliation. See [Firebase Auth trigger documentation](https://firebase.google.com/docs/functions/1st-gen/auth-events).

## Existing orphan cleanup

From `server`, with the intended Firebase project credentials configured:

```sh
npm run cleanup-orphaned-users
npm run cleanup-orphaned-users -- --apply
```

The first command is read-only. Review its UID list before applying. The command includes missing profile parents with remaining subcollections and session-only/reservation-only orphans, checks each UID directly in Auth, and deletes only on `auth/user-not-found`. Permission/network errors stop the command. Cleanup covers that UID's sessions, reservations, and profile descendants; it never deletes a live Auth user. Rerunning is safe. See the cleanup execution record below for the authorized live run.

## Rollout

Deploy the frontend and API changes together, then deploy `functions:cleanupDeletedAccount` using the repository's configured Firebase project. The new function uses a first-generation Auth trigger alongside the existing second-generation metadata trigger. No new Firestore composite index or client rule is required. Existing profiles acquire a reservation when renamed; legacy username lookup remains enabled. Pause administrative profile-backfill jobs during deployment/cleanup.

No code changes have been pushed or deployed. The authorized orphan-data cleanup is recorded below.

## Verification

Regression coverage includes unverified registration, deferred profile creation, verification-time username conflicts, existing-account Google cancellation, username reservation ownership/rename/reuse, legacy profile ownership, deletion ordering/retry, and idempotent Auth-trigger cleanup. Unit tests use mocked Firebase services; deployed trigger delivery, IAM, email delivery, and real concurrent Firestore transactions still need a staging smoke test.

Local results: all 25 frontend suites (326 tests) and 63 backend suites (668 tests) passed. The production frontend build passed. Both lint commands completed with zero errors and existing warnings. `git diff --check` and syntax checks for the new function/cleanup script passed. These test results use mocks; the subsequent authorized live cleanup is recorded below.

## Follow-up: verification during Google password setup

A Google account whose Firebase email remains unverified could reach the password screen, receive `email-verification-required`, and have no way to request an email. That error now opens the shared verification screen with explicit send/check controls. After a successful check reloads the Firebase user and refreshes the token, setup resumes with the chosen username and entered passwords preserved. Pending onboarding no longer resets to the username step during auth-context refreshes. Signing out clears the pending setup UI. Verification remains enforced by the API; linking a provider alone is not treated as proof of verification.

## Authorized orphan cleanup execution

On November 4, 2026, the cleanup ran against `interview-buddy-c9912` using locally supplied service-account credentials. The dry run checked 24 candidate UIDs, preserved 14 authenticated/legacy accounts, and identified 10 missing-Auth orphans. The apply run completed successfully, removing those 10 orphans and their owned data without deleting any Firebase Auth identities. A final independent dry run checked the 14 remaining UIDs and reported 14 accounts preserved and zero orphans. No credential contents were printed or stored in this document. No code was pushed or deployed.

## Follow-up: existing profiles and conflicting setup names

Read-only inspection of the reported account confirmed the same UID exists in Auth and Firestore, has both Google and password providers, and is email verified. Auth displayName contained a stale username draft while the Firestore profile retained its saved name. The setup code updated Auth before the create-profile API could return an existing, authoritative profile; it now mirrors the server-returned username only after persistence succeeds. Profile loading and Google sign-in also repair a differing Auth displayName on a best-effort basis. Firestore remains authoritative.

Auth callbacks and explicit profile refreshes previously used separate race guards. A delayed initial missing-profile response could overwrite the successful setup refresh, sending an already-complete account back through onboarding. They now share a request revision, and the user-facing username comes from the loaded profile. The login UI dismisses an obsolete username/password step when a completed profile arrives. Profile GET requests and API responses disable caching, and malformed successful responses produce a load error instead of being treated as an absent account.

Regression tests cover a delayed missing-profile response after a completed refresh, existing-profile precedence over a draft, uncached reads, malformed profile responses, and dismissal of obsolete onboarding when the saved profile arrives. No code was pushed or deployed.

For the reported account only, an authorized repair validated the expected Auth UID against the Firestore document UID and updated only Auth displayName to the saved Firestore username, `Drenix Sigur?sson`. A subsequent read confirmed the two names match, the email remains verified, and both Google and password providers remain linked. No password, provider, UID, or Firestore profile was changed by this repair.
