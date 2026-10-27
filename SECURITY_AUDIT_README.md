# Interview Buddy security audit

Audit date: **October 27, 2026 (America/Los_Angeles)**  
Reviewed commit: `91f720354534d192582a08f7ffad3ec795a373a8`

## Executive assessment

**The most urgent risks are unrestricted paid AI evaluations, a vulnerable request parser reachable before authentication, unrestricted database work, and acceptance of revoked/deleted-account tokens until expiry.** A normal account can bypass the intended interview sequence, repeat AI grading, and use a separate quiz endpoint to discover answers before submitting them. Completed answers also survive logout in the same browser tab and can appear to the next signed-in user.

The checked-in Firestore rules deny all direct client reads and writes. The application uses server-side Firebase Admin access, so those rules do **not** protect against authorization or abuse bugs in Express. Production rules and IAM were not accessible in this review. The deployment workflow does not deploy the rules, so the presence of the file is not evidence that production is locked down.

No confirmed critical application exploit or exposed operational private key was identified. npm reports critical **dependency advisories**, which are listed separately from demonstrated application vulnerabilities. Their prerequisites must be assessed before calling this application critically exploitable.

Only this audit document was added. No application code, configuration, dependencies, tests, or lockfiles were changed. Nothing was committed, pushed, deployed, or sent to the live application.

## Scope, confidence, and severity

Review covered frontend routes/pages/components and services; authentication and account lifecycle; every Express route; Firestore repositories, quotas, grading, and results; Cloud Functions; seed/administration scripts; CI/CD and hosting configuration; all three dependency lockfiles; local build assets; and available Git history. Styling and image assets were inventoried rather than treated as executable authorization logic. Third-party packages were assessed through dependency advisories and selected implementation checks, not a line-by-line review of their entire source.

This is a repository audit with isolated local validation, **not a guarantee that every vulnerability has been found**. Live Firebase rules, IAM, Auth settings, provider spend limits, deployment headers, bucket permissions, GitHub protections, and production logs were not inspected. No production attack, account creation/deletion, database query, or paid AI request was performed.

- **High:** readily exploitable significant cost, availability, or account-control impact; address before wider exposure.
- **Medium:** meaningful integrity/privacy/abuse weakness, or a conditional deployment risk requiring verification.
- **Low:** limited exposure or hardening gap with narrower consequences.
- **Confirmed:** present in source/configuration; where noted, reproduced with local mocked dependencies.
- **Conditional:** impact depends on a live setting, operational practice, or model behavior not verified here.

The rankings below are application-context judgments, not formal CVSS scores. Related findings describe different controls and should not be added together as independent estimates of loss.

## Ranked findings

| ID | Severity | Finding | Evidence status |
| --- | --- | --- | --- |
| S01 | High | Paid AI evaluations bypass daily quota and session requirements | Reproduced locally |
| S02 | High | Vulnerable JSON body parser runs before authentication | Lockfile + published advisory; no crash attack run |
| S03 | High | Unbounded endpoint/database work enables cost and availability abuse | Confirmed in code |
| S04 | High | Revoked, disabled, or deleted-account tokens remain usable on ordinary routes | Confirmed middleware behavior; live revocation not tested |
| S05 | Medium | Previous user's interview answers survive logout/account switching | Reproduced locally |
| S06 | Medium | Backend bypasses onboarding and email-verification gates; account farming | Confirmed; signup protection settings unknown |
| S07 | Medium | No authoritative question assignment or interview progression | Reproduced locally |
| S08 | Medium | AI answer resubmission overwrites grades; request IDs do not prevent duplicates | Reproduced locally |
| S09 | Medium | Legacy quiz checker is an unlimited answer oracle, including inactive questions | Reproduced locally |
| S10 | Medium | Candidate text can attempt grading prompt injection/reference-answer extraction | Confirmed unsafe trust boundary; model success not tested |
| S11 | Medium | Account deletion can race with writes and leave orphaned data | Confirmed design gap; races not run against Firebase |
| S12 | Medium | Username uniqueness is not atomic | Controlled interleaving reproduced locally |
| S13 | Medium | Profile creation overwrites an existing profile | Reproduced locally |
| S14 | Medium | AI secret shares application database access and is cached indefinitely | Confirmed; IAM exposure conditional |
| S15 | Medium | Production deployment does not publish or verify Firestore rules | Confirmed workflow gap; live rules unknown |
| S16 | Medium | PR previews share production resources and privileged deployment trust | Confirmed configuration; exploit depends on contributor access |
| S17 | Medium | Supply-chain controls do not prevent known-vulnerable or drifting deployments | Confirmed configuration/advisory inventory |
| S18 | Medium | Browser security headers and explicit private-response cache policy are missing from repo configuration | Confirmed configuration; deployed headers unknown |
| S19 | Medium | Interview content retention and third-party processing lack visible controls | Confirmed code/data flow; external policies unknown |
| S20 | Medium, conditional | Password strength and account-enumeration protection rely on unverified Firebase settings | Client behavior confirmed; production policy unknown |
| S21 | Low | Inconsistent input schemas, size limits, and identifier validation | Confirmed |
| S22 | Low | Results page can be reached without a completed interview | Confirmed |
| S23 | Low | Repository/browser/log output exposes unnecessary identifying information | Confirmed |
| S24 | Low | Some internal errors and record-existence distinctions reach clients | Confirmed |
| S25 | Low, conditional | Missing API configuration falls back to plaintext localhost | Confirmed fallback; production workflow supplies `/api` |

### S01 — High: unlimited paid AI evaluations

**Evidence:** [evaluate route](server/src/routes/evaluate.js), lines 35–176; [quota service](server/src/services/questionQuotaService.js); [question retrieval](server/src/routes/questions.js), lines 433–660.

`POST /api/evaluate` accepts a valid Firebase token and an active AI question ID. `metadata.sessionId` is optional; when omitted, ownership/status checks and persistence are skipped, but the paid provider call still happens. The route never calls the quota service or verifies a question reservation. The daily allowance is consumed when retrieving questions, not when grading them.

An ordinary user can learn a valid question ID through normal use and repeatedly submit evaluations, with or without a session. IDs can also be learned from seed data by someone with repository access. Exhausting retrieval quota does not stop this. The provider key need not be stolen: the API acts as a way to spend it. Local probes made three identical sessionless requests and observed three mocked provider calls and zero session lookups.

**Remediation:** require a real owned active session and an assigned question; atomically reserve grading budget before provider work; enforce per-user and project-wide spend/concurrency limits; persist an idempotent evaluation job; reject requests when the budget is exhausted. A retrieval allowance alone is insufficient.

### S02 — High: pre-authentication request-parser denial of service

**Evidence:** [app middleware](server/src/app.js), lines 58–63; [server lockfile](server/package-lock.json) locks `body-parser` **1.20.8** through Express. The functions lockfile also contains 1.20.8; root tooling contains 1.20.4.

`express.json({ limit: "1mb" })` runs before route authentication and retains default compressed-body inflation. The published advisory describes a process-terminating decompression error from a compressed body with trailing bytes. This is a plausible unauthenticated application path regardless of the 1 MB limit; deployment proxy handling could affect actual reachability. No malicious request was sent to the application. [Maintainer advisory GHSA-27r3-jxmh-p828](https://github.com/expressjs/body-parser/security/advisories/GHSA-27r3-jxmh-p828).

**Remediation:** update to a compatible dependency tree with `body-parser` 1.20.9 or later fixed release and verify the resolved lockfile. Reject compressed request bodies if unnecessary. Check the Functions runtime dependency too; its event delivery exposure differs from the public Express API.

### S03 — High: database, storage, and concurrency abuse

**Evidence:** [app](server/src/app.js); [questions](server/src/routes/questions.js), especially lines 194–240, 294–431, 433–660; [sessions](server/src/routes/sessions.js), lines 35–87; [session repository](server/src/repositories/firestore/FirestoreSessionRepository.js), lines 36–100 and 143–155; [AI retry loop](server/src/services/aiService.js); [provider](server/src/services/providers/anthropicProvider.js).

There is no application-wide or per-user request limiter, active-session cap, or persisted storage budget. A user can create unlimited sessions and repeatedly list all their sessions. The history queries have no pagination/limit. Question retrieval and `/questions/options` read the entire mode's question set before filtering; even quota-rejected retrieval requests already performed that read. `/questions/count?...&fresh=1` deliberately bypasses the completed-result cache. Metadata caches and concurrent-refresh coalescing help some reads but do not bound these other paths.

AI work has no application queue, explicit total deadline, or cancellation tied to client disconnect. The app permits three provider attempts. The installed Anthropic SDK defaults to two additional retries for eligible failures and a ten-minute request timeout, so nested retry layers can amplify attempts and occupied capacity. This does **not** imply every failed attempt is billed.

Cloud Run deployment sets `--max-instances=3`, which limits scaling but is not a per-user limiter or AI/database spending cap. Three busy instances can still cause cost and deny service to others. CORS is not protection against scripts using their own valid bearer tokens.

**Remediation:** add distributed per-user/IP/project budgets, bounded queues and in-flight limits, strict deadlines, one retry policy, pagination, storage/session limits, and retention for abandoned sessions. Bound database reads before expensive work; rate-limit forced cache refreshes. Add cost alerts and automated circuit breakers. Configure trusted proxy handling correctly when introducing IP limits.

### S04 — High: token revocation and account disablement are not enforced

**Evidence:** [requireAuth](server/src/middleware/requireAuth.js), line 25; compare [deletion route](server/src/routes/accountDeletion.js), which explicitly calls `verifyIdToken(token, true)`; [role administration](server/scripts/setUserRole.js).

Ordinary routes verify token signature/expiry but do not ask Firebase to check revocation/account status. An already-issued token can therefore remain accepted after account deletion, disablement, refresh-token revocation, or role downgrade until it expires. Firebase ID tokens normally last about one hour. The local probe verified that middleware passes only one argument to verification. [Firebase session management](https://firebase.google.com/docs/auth/admin/manage-sessions).

A stolen token retains API access during that window. An old admin claim also retains the unlimited retrieval allowance after a downgrade. A deleted user can use an old token to recreate Firestore profile/session data through ordinary routes. Deletion's stronger check does not protect these other endpoints. Local sign-out alone is not server-side revocation.

**Remediation:** enforce revoked/disabled/deleted status in a shared admission check; invalidate role-sensitive access promptly; require current account status/profile where appropriate. Use a documented bounded cache if verification cost requires one. Revoke sessions during administrative security actions and make deletion state reject new work.

### S05 — Medium: cross-account results remain in browser memory

**Evidence:** [App](src/App.js), lines 63–97, 110–128 and 159–174; [Sidebar logout](src/components/layout/Sidebar.js), lines 161–172; [results page](src/pages/SessionResultsPage.js); [AuthContext](src/context/AuthContext.js), lines 122–181.

`App` keeps `sessionResult`, `setupData`, and `selectedMode` above the routed pages. Normal logout signs out and navigates to login but does not clear those values. The explicit reset is tied to the account-deleted callback instead. A local React probe completed a result under user A, simulated logout and login as B without remounting the app, and observed A's answer still passed to the routes. B can then visit `/results` and see it. This is a same-tab/shared-device disclosure, not a remote Firestore ownership bypass.

There is also an asynchronous profile race: the AuthContext callback's `active` flag only checks provider unmount, not whether the signed-in UID changed while the profile request was pending. A late response for A can set profile state after B has signed in. This related race was identified statically, not reproduced against Firebase.

**Remediation:** clear all account-specific state on UID changes and sign-out; key/remount the user application by UID; bind pending profile requests/results to the initiating UID; load results from an owned server session instead of unrestricted retained props.

### S06 — Medium: onboarding bypass and account farming

**Evidence:** [ProtectedRoute](src/components/common/protectedRoute.js); [AuthContext](src/context/AuthContext.js), lines 190–197; [requireAuth](server/src/middleware/requireAuth.js), lines 27–37; [registration](src/services/authService.js).

The browser requires both an application profile and a linked password. The API accepts any valid project Firebase token without checking either requirement. It copies `email_verified` into `req.user` but never uses it to deny service. An account midway through Google setup, an account lacking a Firestore profile, or an unverified email/password account can call the protected endpoints directly. Firebase's enabled providers determine which account types can obtain a token; anonymous sign-in was not verified enabled.

Allowances are keyed to UID, so creating additional accounts resets the allowance. No custom-backend App Check validation, verification gate, or app-level anti-automation control is present. Firebase platform protections may exist, but were not inspected. These protections would supplement, not replace, S01/S03 fixes.

**Remediation:** define the actual backend admission policy, enforce it centrally, require verified ownership where appropriate, and apply risk-based signup/abuse controls and shared spend limits. Treat a client-side onboarding wizard as presentation only.

### S07 — Medium: interview assignment and progression are not authoritative

**Evidence:** [session creation](server/src/routes/sessions.js), lines 35–65; [session repository](server/src/repositories/firestore/FirestoreSessionRepository.js), lines 36–49, 161–254 and 259–347; [question retrieval](server/src/routes/questions.js); [evaluate](server/src/routes/evaluate.js), lines 122–151; [frontend session service](src/services/interviewService.js), lines 245–260.

The server stores mode, role and experience but no assigned question IDs, expected question count, selected tags, or next-step state. Retrieval accepts a caller-supplied reservation ID without checking that it names an owned session; reservations are scoped to the caller, so this does not debit another user's quota. Submission only checks question availability/mode and session ownership/status, not that the question belongs to that interview or matches its role/tags/experience.

A user can create a session without completing setup, submit arbitrary known questions of the same mode, exceed the browser's 20-question session cap, or choose only easy questions. Finalization averages only submitted responses and accepts zero answers. Local probes confirmed an unassigned quiz answer is accepted and an empty session becomes completed.

The UI deliberately offers **End Interview** early, so early stopping itself may be intended. The integrity gap is that the server cannot distinguish a completed assignment from an abandoned/partial one, and produces score/ELO-change output without an authoritative denominator. There is no evidence this currently changes a real global leaderboard: that frontend service uses mock data.

**Remediation:** create and reserve a session's questions atomically, store the assignment/settings/count on the server, validate every submission against it, and explicitly model partial/abandoned/completed sessions. Apply order/minimum-completion rules only if the product actually requires them; exclude partial practice from ranked results if ranking is introduced.

### S08 — Medium: repeat AI grading overwrites answers

**Evidence:** [evaluate](server/src/routes/evaluate.js), lines 38, 153–176; [evaluation repository](server/src/repositories/firestore/FirestoreEvaluationRepository.js), lines 53–102.

The API accepts repeated submissions for the same question. The repository writes to `sessions/{sessionId}/responses/{questionId}` with merge and never rejects an existing response. `requestId` is echoed but is not used for idempotency. A user can repeatedly improve an answer using feedback or race concurrent evaluations until a preferred grade is saved. Local probes observed duplicate requests invoking the provider twice and a saved score being replaced from 10 to 100.

The repository does transactionally reject inactive/completed sessions, so this audit does **not** claim evaluations can overwrite a completed session. Work already sent to the provider before completion can still cost money and then fail persistence.

**Remediation:** define an attempt/revision policy; reserve attempts atomically before calling AI; enforce one authoritative response or preserve scored attempts explicitly; cache duplicate request results; bind idempotency to UID/session/question and request content.

### S09 — Medium: quiz answer oracle bypasses one-attempt grading

**Evidence:** [legacy check route](server/src/routes/questions.js), lines 663–772; compare [persisted quiz grading](server/src/repositories/firestore/FirestoreSessionRepository.js), lines 161–254.

`POST /api/questions/:questionId/check` requires authentication but no session, reservation, attempt record, or rate limit. It returns correctness and an explanation for each guess and does not reject inactive questions. An ordinary user can test each multiple-choice option, then submit the correct answer once through the session endpoint. The session endpoint's duplicate prevention does not prevent this preflight. Both repeated guesses and inactive-question checking were reproduced with mocks.

**Remediation:** remove or restrict this legacy route if unused; otherwise apply the same session/attempt policy as persisted grading, with active-question checks and rate limits. If unlimited hints are intentional practice behavior, segregate those results from ranked/scored assessments.

### S10 — Medium: grading prompt injection and reference-answer leakage

**Evidence:** [Anthropic prompt construction](server/src/services/providers/anthropicProvider.js), lines 53–106; [evaluation normalization](server/src/services/evaluationContract.js).

Candidate-controlled text is inserted into the same user-role message as grading instructions, private reference answers, and rubrics. A candidate can add competing instructions to award full points, reproduce the private answer in `feedback`, or perform unrelated tasks. JSON and numeric-range validation constrain output structure; they do not establish that the model followed the grading policy or kept reference material private.

This is a prompt-level risk, not demonstrated model exploitation: no paid AI call was made. The Anthropic API key is supplied to the SDK, not included in the model prompt, so prompt injection alone is **not evidence of API-key extraction**. No tool use or candidate-code execution was found.

**Remediation:** separate trusted system policy from explicitly delimited untrusted candidate content, test adversarial grading cases, limit disclosure in feedback, and use deterministic checks where feasible. Do not treat model scores as tamper-proof evidence for high-stakes/ranked decisions. Instructions and delimiters reduce risk but cannot guarantee secrecy of material given to a model.

### S11 — Medium: deletion does not close all data-creation paths

**Evidence:** [account deletion service](server/src/services/accountDeletionService.js), lines 11–58; [deletion route](server/src/routes/accountDeletion.js); [auth registration/cancellation](src/services/authService.js); [functions](functions/index.js).

Deletion removes sessions and user subcollections before deleting the Auth identity, but never marks the account as deleting or blocks concurrent writes. Another request can create data after its relevant cleanup pass. S04 permits new requests with the old token after identity deletion as well. The cleanup loop also has no overall duration/work cap and can be prolonged by continued session creation.

Firebase client account deletion exists separately from `/api/users/account`; this application itself uses `deleteUser` during rollback/cancellation. No Auth-user-deletion cleanup trigger or reconciliation job appears in the repository. Deleting directly through Firebase, or deleting an incomplete account after directly using the API, can leave sessions/usage behind. A partial final cleanup failure is correctly reported, but recovery requires an administrator and is not automated.

**Remediation:** enforce a deletion/tombstone state before cleanup, block writes, revoke access, use an idempotent durable cleanup job, and reconcile Auth deletions regardless of origin. Account for nested responses, usage, reservations, retries, and backup retention. Preserve the existing recent-login and identity checks.

### S12 — Medium: duplicate usernames through concurrent requests

**Evidence:** [profile routes](server/src/routes/users.js), lines 44–84; [user repository](server/src/repositories/firestore/FirestoreUserRepository.js), lines 46–75 and 166–203.

Username uniqueness uses a query followed by a separate write. Two users can both observe an available name and claim it concurrently. Case normalization does not fix the race. A controlled interleaving with fake Firestore reads reproduced two profiles claiming the same normalized name.

This creates impersonation/identity ambiguity; authentication itself uses UID/email, so duplicate names do not by themselves grant another account's access. Future friend/leaderboard/moderation features would amplify the impact.

**Remediation:** reserve a canonical username in a uniquely keyed document inside a transaction that updates the profile and releases any old reservation. Apply the same invariant to creation, rename, imports, and deletion.

### S13 — Medium: POST profile resets existing records

**Evidence:** [profile POST](server/src/routes/users.js), lines 44–84; [createProfile](server/src/repositories/firestore/FirestoreUserRepository.js), lines 28–77.

Any authenticated user can call profile creation repeatedly for their own UID. It uses `.set(profile)` rather than a create-only operation, resetting `createdAt`, stored role, settings and other existing fields. The probe confirmed an existing display name disappears and stored role/theme reset. This affects the caller's record; it is not a cross-user write or a way to set an admin custom claim. Existing usage subcollections survive overwriting the parent document, so this is **not** a demonstrated quota reset.

It can also make Firestore's role disagree with the signed token role used by authorization.

**Remediation:** make onboarding creation transactionally create-only or safely idempotent; update supported fields through PATCH; keep privileged roles/server timestamps out of reinitializable profile logic.

### S14 — Medium: provider secret storage and rotation exposure

**Evidence:** [AI config](server/src/config/aiConfig.js), lines 3–34; [Firebase Admin setup](server/src/firebaseAdmin.js); local `server/.env` variable-name inspection.

The operational provider reads `anthropicApiKey` from `serverConfig/ai`, alongside the application database, and caches the entire configuration for the process lifetime. Database readers/export operators with access to that document may therefore also gain the paid provider credential. The actual IAM grants are unknown. Deny-all client rules are a useful barrier if deployed, but Admin access uses IAM instead. [Firestore rules and server client access](https://firebase.google.com/docs/firestore/security/rules-conditions).

Updating the database key does not refresh already-running processes. Multiple Cloud Run instances can continue using old values until restarted. Local `server/.env` also contains an `ANTHROPIC_API_KEY` entry, although this implementation obtains the key from Firestore; its value and validity were not displayed or tested. Duplicate secret locations complicate rotation. This is **not a confirmed public key leak**.

**Remediation:** use a dedicated secret manager and least-privilege runtime identity, separate secret access from routine database access/exports, define versioned rotation and instance refresh, revoke old keys promptly, and remove obsolete local secret copies. Set provider-side spending controls independently of application quota.

### S15 — Medium: Firestore rule changes do not follow production deployment

**Evidence:** [rules](firestore.rules); [Firebase config](firebase.json); [CD](.github/workflows/cd.yml).

The checked-in rules deny all reads/writes, but CD deploys Cloud Run, optionally the metadata function, and Hosting. It never deploys `firestore:rules` or validates production rule behavior. A previous permissive rule deployment could remain in production while every CI/CD run is green.

The gap is confirmed; an open production database is **not** confirmed. If production permits access to `serverConfig/ai`, user records, responses, or question answers, severity becomes High or Critical depending on scope and credential exposure.

**Remediation:** deploy reviewed rules as part of a controlled release; test anonymous and signed-in denial with the emulator; independently verify every deployed database/ruleset. Review IAM separately because rules do not constrain Admin SDK calls.

### S16 — Medium: preview environments and deployment credentials share trust

**Evidence:** [PR preview workflow](.github/workflows/firebase-hosting-pull-request.yml); [hosting rewrites](firebase.json); [deployment documentation](docs/DEPLOYMENT_WORKFLOW.md).

Same-repository PRs build contributor-controlled code and deploy it using a long-lived Firebase service-account secret. Fork PRs are correctly excluded. A malicious or compromised contributor able to change code/workflows in same-repository branches can target the credential-bearing preview job. Package scripts and subsequent deployment steps run in the same job; their exact isolation and account permissions are not established here.

Previews also use the production Firebase configuration and shared Cloud Run rewrite. Preview code can act on the signed-in tester's production account and consume production resources. This becomes a phishing/data-exfiltration path if an untrusted preview asks a tester to authenticate. It does not mean a preview inherently grants access to every user's records.

**Remediation:** isolate preview Auth/database/backend/key budgets in a staging project; minimize deployer permissions and secret lifetime; use federation where supported; protect credential-bearing workflow changes and require review appropriate to contributor trust. Verify branch rules and WIF issuer/repository/ref conditions rather than assuming them.

### S17 — Medium: dependency and CI/CD supply-chain gaps

**Evidence:** three lockfiles; [CI](.github/workflows/ci.yml); [CD](.github/workflows/cd.yml); [PR previews](.github/workflows/firebase-hosting-pull-request.yml). Complete package inventory follows below.

All three dependency trees have advisory findings. S02 is the clearest public-runtime issue. Most root advisories concern build/test/dev-server tooling, despite npm classifying those packages under production dependencies because `react-scripts` is a normal dependency. The deployed Firebase Hosting frontend is static; it does not run webpack-dev-server, Babel, or a Node gRPC server for visitors.

CI/CD uses mutable action tags rather than immutable commit hashes. Functions dependencies use `npm install` during CI and again during CD instead of an immutable `npm ci` resolution. The pipeline has tests/lint but no explicit security-advisory gate, secret scan, or Firestore-rules test. GitHub-side Dependabot and branch protections may exist but were not inspected. These gaps increase the chance a vulnerable or changed dependency reaches a privileged runner/release.

**Remediation:** triage the inventory by runtime reachability, refresh supported dependencies with compatibility testing, pin action commits, use reproducible installs, add advisory/secret/rules checks and review dependency changes. Do not apply `npm audit fix --force` blindly: npm suggested inappropriate changes such as `react-scripts@0.0.0` and a Firebase downgrade. Nothing was upgraded during this audit.

### S18 — Medium: browser hardening and private caching policy

**Evidence:** [hosting configuration](firebase.json); [HTML](public/index.html); [Express app](server/src/app.js); individual API routes.

The repository sets no CSP, `frame-ancestors`/X-Frame-Options, or consistent explicit security-header policy. It also lacks a consistent `Cache-Control: no-store` policy for user/profile/session/evaluation responses; metadata/count routes set it selectively. Live hosting/proxy headers were not measured, so this is not proof of an exploitable production framing or caching issue.

Missing anti-framing can enable clickjacking if a hostile page can frame the authenticated app under actual browser persistence restrictions. Missing CSP increases the impact of a future script injection or compromised dependency. Private responses could persist in browser/proxy caches according to their actual caching behavior; no shared-cache disclosure was demonstrated.

**Remediation:** inspect actual HTTPS response headers; apply a tested CSP and anti-framing policy, MIME protection and appropriate referrer policy; explicitly mark sensitive responses private/no-store. Preserve Firebase sign-in/popup compatibility. HTTPS/HSTS may already be supplied by the platform and should be verified rather than assumed absent.

### S19 — Medium: sensitive content lifecycle is underspecified

**Evidence:** [provider](server/src/services/providers/anthropicProvider.js), lines 53–106; [evaluation storage](server/src/repositories/firestore/FirestoreEvaluationRepository.js), lines 89–102; [quiz storage](server/src/repositories/firestore/FirestoreSessionRepository.js), lines 235–246; [mock history facade](src/services/historyService.js).

Written answers/code and private question material are sent to Anthropic, and candidate responses/feedback are persisted in Firestore. No retention/TTL cleanup, explicit content-redaction control, or provider-processing notice was found in the reviewed user flow. Users may paste confidential employer code or personal information. Provider account retention settings, contractual policies, database backup policy, and organizational notices are unknown; no legal conclusion is asserted.

The history facade's `deleteSession` is explicitly simulated and does not delete persisted sessions; there is no corresponding server session DELETE endpoint. A future UI presenting it as actual deletion would mislead users. Existing whole-account deletion has the limitations in S11.

**Remediation:** state what is sent/stored, avoid unnecessary sensitive content, configure retention with the provider and database, offer genuine deletion where promised, and document backup/log retention and privileged access.

### S20 — Medium, conditional: password and account-discovery protections

**Evidence:** [registration page](src/pages/RegisterPage.js), lines 87–93; [auth service](src/services/authService.js), password validation/change/reset and error mappings.

Client validation accepts passwords as short as six characters. A stronger live Firebase password policy may override that; none was verified. Google onboarding requires adding a password, creating an additional sign-in path whose strength matters even for an otherwise well-protected Google account. No application MFA enrollment/step-up flow was found; Firebase configuration and user factors were not inspected.

Registration explicitly reports an existing email, and password-reset handling maps `auth/user-not-found` to an account-specific message. Whether Firebase actually emits that error depends on its email-enumeration protection settings. This is a conditional discovery risk, not proof that current production exposes all account existence checks. Login already uses generic invalid-credential messages.

**Remediation:** enforce an appropriate server-side Firebase password policy, verify email-enumeration protection and authentication abuse limits, return neutral reset/signup responses where practical, and apply stronger authentication to privileged accounts. Reconsider whether a mandatory password is necessary for Google-only users.

### S21 — Low: inconsistent validation and oversized fields

**Evidence:** [users](server/src/routes/users.js), lines 50–54 and 148–174; [session creation](server/src/routes/sessions.js), lines 37–63; [evaluate](server/src/routes/evaluate.js), lines 44–96; [question checks](server/src/routes/questions.js).

Several fields are coerced with `String(...)` rather than validated as strings. Username/display name/session role/experience have no small domain-specific length limits; session creation accepts any nonempty mode instead of the actual mode enum. Question/session IDs passed to Firestore `.doc()` are not consistently restricted to a single document-ID segment; invalid/slash-containing values can generate unexpected-path lookups or errors. The 1 MB body limit and 10,000-character AI response cap are real protections, but do not replace per-field validation.

Likely consequences are malformed records, display-name impersonation/control-character confusion, wasted reads/writes and error flooding. No SQL injection, arbitrary root-collection traversal, or cross-user document access was established from these inputs.

**Remediation:** centralize strict schemas, canonical username rules/lengths, allowed modes, safe integer limits and single-segment IDs; reject unexpected fields/types early with 400 responses.

### S22 — Low: results URL does not require a completed session

**Evidence:** [routes](src/utils/routes.js), results route; [App defaults](src/App.js), lines 79–95; [results page](src/pages/SessionResultsPage.js).

An onboarded user can navigate directly to `/results`. `App` initializes a non-null default result, so the page's missing-result guard does not reject it and fabricated default results can appear. The route checks account access, not interview progression. This is a presentation/integrity issue; it does not persist a forged database score. S05 is the more serious case when retained results belong to another user.

**Remediation:** bind results to an actual owned completed session and display an empty/redirect state when absent. Keep setup/session/results prerequisites explicit on both client and server where security depends on them.

### S23 — Low: unnecessary identifying data in code and logs

**Evidence:** [App console logging](src/App.js), lines 30–38; [test-account reset script](server/scripts/resetGoogleTestAccounts.js), lines 8–17; [server error logger](server/src/app.js), line 120; checked-in `server/B01-S01-run*.txt`.

App logs the mapped current user, which contains UID/email/provider details, not the bearer token. The reset script hard-codes two email/UID pairs. Checked-in test output includes developer-local paths. These expose identifying information to people with repository/log/console access; whether the repository is public and whether the accounts remain live are unknown. This report deliberately does not repeat their values.

The server logs whole error objects and AI retry messages without a redaction layer. Depending on SDK error structure, this can expose additional request/provider context; no secret-bearing runtime log was observed. The local build also has source maps. Public frontend source maps are not themselves a secret leak, and the scanned build contained no private-key/Anthropic-key pattern.

**Remediation:** remove production user debugging, use synthetic or externally supplied test identities, avoid unnecessary checked-in logs, and implement structured/redacted error logging with access/retention controls. Decide source-map publishing intentionally.

### S24 — Low: internal details and existence oracle

**Evidence:** [evaluate error handling](server/src/routes/evaluate.js), lines 178–186; [AI configuration](server/src/config/aiConfig.js); [session reads](server/src/routes/sessions.js), lines 92–109; [results access checks](server/src/services/sessionResultsService.js).

Status-bearing AI errors are returned verbatim, potentially revealing configuration document paths, rubric configuration problems, or provider error details. Central generic errors are otherwise appropriately hidden. Session routes distinguish a missing session (404) from someone else's existing session (403), disclosing existence to someone who already knows/guesses an ID. Random Firestore IDs and ownership checks limit the impact; content is still denied.

**Remediation:** return stable public error codes/messages, log sanitized diagnostics internally, and consider a uniform not-found response for inaccessible resources. Preserve actionable non-sensitive validation errors.

### S25 — Low, conditional: plaintext localhost API fallback

**Evidence:** API base URL constants across `src/services/*.js`; [CI build environment](.github/workflows/ci.yml).

If API configuration is omitted, service code sends bearer-authenticated requests to `http://localhost:5001/api`. Production CI explicitly sets `/api`, so this is a misbuild/local-development risk rather than a demonstrated production token leak. A custom build could contact an unintended local service or fail because of browser network restrictions.

**Remediation:** require valid API configuration outside development, use HTTPS/same-origin production URLs, and fail closed instead of silently choosing localhost in production.

## Endpoint and page coverage

All business API route groups are mounted behind Firebase-token authentication in `app.js`. The exceptions are the public health route and CORS preflight handling. The global JSON parser runs before authentication.

| Endpoint | Authorization/control present | Remaining concern |
| --- | --- | --- |
| `GET /api/health` | Intentionally public, limited build metadata | Parser/global availability risks; no private config in its response |
| `GET /api/questions` | Token, mode/filter checks, 1–20 retrieval cap, transactional caller quota | Full-mode read before quota rejection; reservation not bound to real owned session |
| `GET /api/questions/options` | Token, allowed mode | Full-mode query repeatedly; no rate limit |
| `GET /api/questions/count` | Token, required filters, cache | Caller can force refresh; no rate limit |
| `GET /api/questions/quota` | Token, UID from token, admin claim normalization | Farming, stale admin token, unlimited status requests |
| `GET /api/questions/metadata` and `/metadata/version` | Token, caches, safe metadata builder | No overall request budget; public bundled metadata is expected |
| `POST /api/questions/:questionId/check` | Token, quiz-mode check | Unlimited guessing, no active/session/attempt check |
| `POST /api/evaluate` | Token, active AI question, 10k answer cap; ownership if session supplied | Sessionless cost abuse, no grading quota/assignment/idempotency |
| `POST /api/sessions` | Token UID used as owner; required text | Unlimited creation, arbitrary mode/settings, no stored assignment |
| `GET /api/sessions[?status=completed]` | Query scoped to token UID | Unbounded result set/read cost |
| `GET /api/sessions/:sessionId` | Explicit owner check | Existence distinction; permissive ID validation |
| `POST /api/sessions/:sessionId/quiz-answers` | Owner, active quiz session, valid option, duplicate rejection in transaction | No assignment/sequence/count enforcement; legacy oracle defeats one attempt |
| `PATCH /api/sessions/:sessionId/complete` | Owner/status/score validation in transaction, idempotent completion | Empty/partial/cherry-picked sessions accepted; no expected denominator |
| `GET /api/users/profile`, `GET /api/users/settings` | Token UID; no caller-supplied target UID | Stale account status, private cache policy |
| `POST /api/users/profile` | Token UID, normalized-name collision query | Overwrites existing profile; uniqueness race; no onboarding gate |
| `PATCH /api/users/profile` | UID-scoped and supported-field allowlist | Username race/validation limits |
| `PATCH /api/users/settings` | UID-scoped, theme/boolean validation | General rate limits/account status; no demonstrated privilege escalation |
| `DELETE /api/users/account` | `DELETE` confirmation, revoked-token check, matching UID, authentication within five minutes | Concurrent writes/orphans and durable cleanup missing |

| Pages | Current access behavior | Assessment |
| --- | --- | --- |
| `/login`, `/register`, `/forgot-password` | Public | Expected; Firebase policy/abuse configuration needs verification |
| `/dashboard`, `/history`, `/leaderboard`, `/analytics`, `/settings` | `ProtectedRoute`: auth + profile + linked password | No obvious missing frontend auth wrapper; backend onboarding differs |
| `/interview/setup`, `/interview/session` | Same auth wrapper plus local state checks | Direct visits generally show missing setup; APIs still allow bypassing the sequence |
| `/results` | Auth wrapper only | Default/stale result display; cross-account local-state leak |
| `/settings/password` | Protected redirect to settings | No standalone unprotected password-change page found |
| Unknown paths | Redirect to dashboard, then protected route | No demonstrated protected-page bypass from catch-all routing |

Downloading the public SPA JavaScript or receiving `index.html` for a protected route is expected. Backend authorization, not secrecy of frontend code, must protect data. History/leaderboard and parts of dashboard/analytics currently use mock data; their display does not demonstrate a database leak or a real global ranking update.

## Database and API-key assessment

| Asset/control | What this review established | What remains to verify |
| --- | --- | --- |
| Firestore client access | Repository rules deny all documents | Those rules are deployed to the correct project/database |
| Server access | Admin SDK bypasses client rules; routes enforce UID ownership in key paths | Runtime/deployer/human IAM roles, separation of duties, export access |
| Anthropic credential | Retrieved server-side from `serverConfig/ai`; not placed in the prompt or public response | Secret ACLs, rotation, provider restrictions/spending limits, external leaks |
| Firebase web API key | Intended browser-visible configuration in `src/config/firebase.js` | API restrictions, Auth quotas, enumeration protection and abuse controls |
| Service-account credentials | ADC/platform identity supported; example env files contain placeholders | Long-lived keys outside repo, GitHub-secret scope, workstation/cloud IAM |
| Usage/reservations | Transactional per-UID retrieval accounting, fingerprint conflict protection | Evaluation charging, abandoned reservation lifecycle, multi-account abuse |
| User sessions/responses | Server owner checks and server grading; direct clients denied if rules deployed | Retention, backups, access audits, deletion reconciliation |
| Cloud Storage | Bucket config exists; no application upload/download feature or storage rules found | Any existing bucket exposure, objects, signed URLs and IAM; not inferable from Firestore rules |

Firebase web API keys identify the project and are generally not secrets or database passwords. Their public presence is not a credential leak, and hiding them cannot replace database authorization. Restrict inappropriate API use and monitor Auth abuse. [Firebase API-key guidance](https://firebase.google.com/docs/projects/api-keys).

The source review found no public question endpoint returning `referenceAnswer`, `gradingCriteria`, or `correctAnswer` directly in its normal question list. The quiz oracle and AI feedback channel are separate indirect disclosure risks. Private answers/rubrics are in the seed repository, so anyone with repository access can read them; that matters if this is intended to become a competitive assessment bank. Repository visibility was not checked.

## Production checks needed to close uncertainty

These are **unverified conditions**, not claims that the deployed project is currently misconfigured.

| Verification | Potential severity if unsafe | Evidence needed |
| --- | --- | --- |
| Firestore rules deny anonymous and signed-in clients for users, responses, questions and server config | Critical if broad data/secret exposure | Deployed rules + controlled emulator/production read-denial checks |
| Runtime and human IAM avoid excessive project-wide privileges; provider secret access is restricted | High–Critical | IAM policy/service-account/export/secret-access review |
| Firebase API key restricted to intended APIs; Auth signup/reset quotas and bot protection suitable | Medium–High | Google Cloud and Firebase Auth settings |
| Disabled/revoked/deleted tokens rejected across APIs | High | Controlled test accounts and lifecycle integration tests after S04 fix |
| Anthropic spend/concurrency limits and cloud billing alerts/circuit breakers set | High | Provider/cloud settings and alert ownership |
| Public Cloud Run URL cannot bypass any edge-only protection | High | Ingress/IAM/load-balancer configuration; middleware protection on every path |
| No unneeded Firebase Auth providers enabled; password/verification/MFA/enumeration policies set | Medium–High | Auth configuration, including authorized domains and preview access |
| Storage buckets, exports, backups and logs inaccessible to unintended users | High | Bucket/IAM/retention review; no storage feature was tested here |
| Production and preview environments isolated, PR deployment credentials restricted | High | Separate projects/accounts and deployment permissions |
| GitHub branch rules, required reviews, workflow CODEOWNERS/WIF conditions/secrets protected | High | Repository/organization settings; automatic deploy alone is not proof of a vulnerability |
| CSP/framing/cache/HTTPS headers correct at actual hosting and direct API URLs | Medium | Deployed response-header inspection |
| Backups/PITR and cleanup/retention recoverable and consistent with deletion promises | Medium–High | Recovery exercise and documented retention policy |

## Positive controls and claims not established

- Firebase Admin verifies bearer tokens; there is no obvious unsigned-JWT trust or client-supplied UID authorization.
- Session reads/completion and persisted quiz grading check ownership. AI grading checks ownership when a session is supplied. No working cross-user session IDOR was found.
- Roles used for quota bypass come from verified token custom claims, not the profile-update request. Profile/settings routes allowlist supported fields. No ordinary-user-to-admin escalation was demonstrated.
- Retrieval quota transactions and reservation fingerprints prevent concurrent over-consumption on that particular path. This does not cover evaluation.
- Quiz persistence rejects duplicates; evaluation persistence rechecks session activity transactionally; finalization is idempotent and validates server-stored scores.
- Account deletion has recent-login, revocation, identity and typed-confirmation checks. Password changes reauthenticate through Firebase. These should be retained.
- React text rendering is used for user/model feedback. No `dangerouslySetInnerHTML`, attacker-controlled HTML execution, or candidate-code execution path was found. Prompt injection is not JavaScript execution.
- No user-controlled outbound URL fetch, SQL database/query construction, shell execution from candidate input, or upload endpoint was identified. No SSRF, SQL injection, RCE, or file-upload exploit is claimed.
- Bearer authorization is supplied explicitly, rather than an automatically attached API authentication cookie; no classic cookie-based CSRF exploit was established. CORS itself is not authentication.
- Root build assets and current tracked files contained no high-confidence Anthropic/private-key/GitHub-token pattern. Available history was also scanned: 5,529 blobs across 238 reachable commits. Thirteen hits were reviewed as historical dependency documentation/PEM-parser markers, not identified operational credentials. This pattern scan cannot rule out unknown/encoded secrets, remote/deleted/unreachable history, external artifacts, or leaked values outside the checkout. Local secret values were not printed or validated.

## Validation performed

| Check | Result |
| --- | --- |
| Existing backend Jest suite, run serially without cache | **28 suites, 337 tests passed** |
| Existing frontend suite, CI mode, serial, without cache | **18 suites, 268 tests passed** |
| In-memory route/middleware/repository probes | Confirmed sessionless/repeated AI calls, absent revocation flag, unassigned quiz acceptance, zero-answer completion, grade overwrite, legacy quiz oracle, username race and profile replacement |
| In-memory React account-switch probe | Confirmed old answer remains after A logout/B login in the same mounted App |
| npm advisory queries for root, server and functions | Successful inventories summarized below; initial sandbox/network failure was retried read-only |
| Tracked files/history/build secret-pattern scan | No operational credential identified within the stated pattern/scope limits |

The probes used fake Firebase/provider implementations and temporary in-process harnesses, not new repository test files. Passing existing tests does not prove these security invariants: several missing controls were reproduced despite the green suite. No dependency installation, audit fix, seeding, administration script, or live smoke test was run.

## Recommended remediation order

1. **Before broader deployment:** patch the reachable body-parser advisory; require session/assignment and enforce AI spend limits; add backend request/work budgets; enforce account revocation/deletion state. Verify deployed rules/IAM and provider spend controls immediately.
2. **Next:** clear per-account browser state; make grading idempotent; close the quiz oracle; store authoritative assignments; harden deletion and transactional username/profile creation.
3. **Then:** isolate preview infrastructure, establish reproducible/pinned deployments and advisory checks, add security headers, improve secret rotation, authentication policy, retention, and sanitized logging.
4. **Regression coverage after fixes:** test unauthorized/other-user access, revoked/deleted/unverified/incomplete users, concurrent requests, retries, duplicate grading, assignment mismatch, partial/empty completion, account switching, deletion races, and Firestore deny-all behavior. Use mocked/provider-sandbox tests so abuse tests cannot spend production AI budget.

## Dependency advisory inventory

These are **npm-reported affected package counts**, including transitive parent packages, not counts of distinct exploits. Trees overlap; do not sum them into a unique vulnerability total. `moderate` below is npm's label. Advisories can change after this audit date.

| Dependency tree | Critical | High | Moderate | Low | Total affected packages |
| --- | ---: | ---: | ---: | ---: | ---: |
| Root frontend/build/test tree | 3 | 35 | 11 | 10 | 59 |
| Express server | 1 | 3 | 9 | 0 | 13 |
| Cloud Functions | 0 | 1 | 9 | 0 | 10 |

### Runtime interpretation

- **Prioritize:** server `body-parser@1.20.8`, as explained in S02.
- **Critical package, exploit prerequisites not found:** server/root `proxy-addr@2.0.7`. The advisory requires specific unsafe proxy-trust subnet configuration and security decisions based on spoofable client IP. This app does not configure that trust or use IP authorization. Patch it, especially before adding IP rate limits, but do not call the current bearer authentication bypassed. [Maintainer advisory GHSA-jqcg-44mw-7w3h](https://github.com/jshttp/proxy-addr/security/advisories/GHSA-jqcg-44mw-7w3h).
- **High package, affected server feature not found:** server `@grpc/grpc-js@1.14.4` and root `1.9.16`. The certificate advisory concerns a gRPC server using `getAuthContext` under particular client-certificate settings. This project uses Firestore as a client, not that gRPC authentication design. Functions locks `1.14.6`. [Maintainer advisory GHSA-m9gg-hp2v-232j](https://github.com/grpc/grpc-node/security/advisories/GHSA-m9gg-hp2v-232j).
- **Developer exposure:** root `webpack-dev-server@4.15.2`, `launch-editor`, `shell-quote`, WebSocket packages and build parsers have substantial advisories. These affect local/CI workflows under their prerequisites, not automatically the deployed static SPA. This Windows workspace makes editor/UNC-path advisories particularly relevant to developer triage. Avoid exposing development servers and do not process untrusted projects/assets with vulnerable tooling.
- **React Router:** root `6.30.6` is flagged for open redirect and SSR error-deserialization issues. Navigation in this SPA uses fixed `PAGES` paths, and SSR hydration was not found; no reachable exploit was demonstrated.
- **Other transitive alerts:** `uuid`, `qs`, brace parsing and similar findings depend on vulnerable APIs/options receiving attacker-controlled inputs. Package presence alone is insufficient. Treat the full inventory as a remediation checklist, not proof of all advertised impacts.

### Express server: all reported affected packages

| Package | npm severity | Advisory or dependency chain |
| --- | --- | --- |
| `proxy-addr` | critical | [GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h) |
| `body-parser` | high | [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828) |
| `@grpc/grpc-js` | high | [GHSA-m9gg-hp2v-232j](https://github.com/advisories/GHSA-m9gg-hp2v-232j), [GHSA-f596-whhp-79r4](https://github.com/advisories/GHSA-f596-whhp-79r4) |
| `brace-expansion` | high | [GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr), [GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7), [GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p); development/tooling exposure |
| `qs` | moderate | [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx), [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g), [GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw) |
| `uuid` | moderate | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) |
| `@google-cloud/firestore` | moderate | `google-gax` |
| `@google-cloud/storage` | moderate | `retry-request`, `teeny-request` |
| `firebase-admin` | moderate | Firestore/storage dependency chains |
| `gaxios` | moderate | `uuid` |
| `google-gax` | moderate | `retry-request`, `uuid` |
| `retry-request` | moderate | `teeny-request` |
| `teeny-request` | moderate | `uuid` |

### Root frontend/build/test tree: all reported affected packages

| Package | npm severity | Direct advisories / affected dependency chain |
| --- | --- | --- |
| `proxy-addr` | critical | [GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h) |
| `shell-quote` | critical | [GHSA-w7jw-789q-3m8p](https://github.com/advisories/GHSA-w7jw-789q-3m8p), [GHSA-395f-4hp3-45gv](https://github.com/advisories/GHSA-395f-4hp3-45gv) |
| `websocket-driver` | critical | [GHSA-mp7j-qc5w-4988](https://github.com/advisories/GHSA-mp7j-qc5w-4988), [GHSA-xv26-6w52-cph6](https://github.com/advisories/GHSA-xv26-6w52-cph6) |
| `@babel/plugin-transform-modules-systemjs` | high | [GHSA-fv7c-fp4j-7gwp](https://github.com/advisories/GHSA-fv7c-fp4j-7gwp) |
| `@firebase/firestore` | high | `@grpc/grpc-js` |
| `@firebase/firestore-compat` | high | `@firebase/firestore` |
| `@grpc/grpc-js` | high | [GHSA-m9gg-hp2v-232j](https://github.com/advisories/GHSA-m9gg-hp2v-232j), [GHSA-f596-whhp-79r4](https://github.com/advisories/GHSA-f596-whhp-79r4) |
| `@svgr/plugin-svgo` | high | `svgo` |
| `@svgr/webpack` | high | `@svgr/plugin-svgo` |
| `bfj` | high | `jsonpath` |
| `body-parser` | high | [GHSA-v422-hmwv-36x6](https://github.com/advisories/GHSA-v422-hmwv-36x6), [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828) |
| `brace-expansion` | high | [GHSA-3jxr-9vmj-r5cp](https://github.com/advisories/GHSA-3jxr-9vmj-r5cp), [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg), [GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895), [GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr), [GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7), [GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p) |
| `browserslist` | high | [GHSA-c83g-rgw3-j3cx](https://github.com/advisories/GHSA-c83g-rgw3-j3cx), [GHSA-73wf-gq98-2v4g](https://github.com/advisories/GHSA-73wf-gq98-2v4g) |
| `compression` | high | [GHSA-vc2v-76pw-4v95](https://github.com/advisories/GHSA-vc2v-76pw-4v95) |
| `css-select` | high | `nth-check` |
| `fast-uri` | high | [GHSA-v2hh-gcrm-f6hx](https://github.com/advisories/GHSA-v2hh-gcrm-f6hx), [GHSA-7p8r-x3mc-p8w7](https://github.com/advisories/GHSA-7p8r-x3mc-p8w7), [GHSA-q3j6-qgpj-74h6](https://github.com/advisories/GHSA-q3j6-qgpj-74h6), [GHSA-v39h-62p7-jpjc](https://github.com/advisories/GHSA-v39h-62p7-jpjc), [GHSA-f65p-4m7j-42xc](https://github.com/advisories/GHSA-f65p-4m7j-42xc), [GHSA-jqff-g426-hqxp](https://github.com/advisories/GHSA-jqff-g426-hqxp), [GHSA-4c8g-83qw-93j6](https://github.com/advisories/GHSA-4c8g-83qw-93j6), [GHSA-qw65-cvwx-89v3](https://github.com/advisories/GHSA-qw65-cvwx-89v3), [GHSA-hrr3-gc8f-f4qj](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj), [GHSA-w74x-v6f9-j3xg](https://github.com/advisories/GHSA-w74x-v6f9-j3xg), [GHSA-xhq7-xmqj-769h](https://github.com/advisories/GHSA-xhq7-xmqj-769h), [GHSA-333x-w4r6-6crp](https://github.com/advisories/GHSA-333x-w4r6-6crp) |
| `firebase` | high | `@firebase/firestore`, `@firebase/firestore-compat` |
| `follow-redirects` | high | [GHSA-q3jh-wrc6-jgq8](https://github.com/advisories/GHSA-q3jh-wrc6-jgq8), [GHSA-8r9p-f939-6h3c](https://github.com/advisories/GHSA-8r9p-f939-6h3c) |
| `form-data` | high | [GHSA-hmw2-7cc7-3qxx](https://github.com/advisories/GHSA-hmw2-7cc7-3qxx) |
| `js-yaml` | high | [GHSA-h67p-54hq-rp68](https://github.com/advisories/GHSA-h67p-54hq-rp68), [GHSA-52cp-r559-cp3m](https://github.com/advisories/GHSA-52cp-r559-cp3m), [GHSA-5p4m-2wfm-xmqj](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj), [GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh) |
| `jsonpath` | high | `underscore` |
| `launch-editor` | high | [GHSA-v6wh-96g9-6wx3](https://github.com/advisories/GHSA-v6wh-96g9-6wx3), [GHSA-698v-4r3x-3vcv](https://github.com/advisories/GHSA-698v-4r3x-3vcv), [GHSA-r825-w8mm-5pxw](https://github.com/advisories/GHSA-r825-w8mm-5pxw), [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm) |
| `nanoid` | high | [GHSA-28wg-ghj8-5hjv](https://github.com/advisories/GHSA-28wg-ghj8-5hjv), [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8), [GHSA-xwg4-73v4-xw9w](https://github.com/advisories/GHSA-xwg4-73v4-xw9w) |
| `node-forge` | high | [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) |
| `nth-check` | high | [GHSA-rp65-9cf3-cjxr](https://github.com/advisories/GHSA-rp65-9cf3-cjxr) |
| `postcss` | high | [GHSA-7fh5-64p2-3v2j](https://github.com/advisories/GHSA-7fh5-64p2-3v2j), [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93), [GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q), [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp), [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) |
| `react-scripts` | high | `@svgr/webpack`, `css-minimizer-webpack-plugin`, `jest`, `resolve-url-loader`, `webpack-dev-server`, `workbox-webpack-plugin` |
| `rollup-plugin-terser` | high | `serialize-javascript` |
| `serialize-javascript` | high | [GHSA-5c6j-r48x-rmvq](https://github.com/advisories/GHSA-5c6j-r48x-rmvq), [GHSA-qj8w-gfj5-8c6v](https://github.com/advisories/GHSA-qj8w-gfj5-8c6v), [GHSA-m5mm-p8h7-m29v](https://github.com/advisories/GHSA-m5mm-p8h7-m29v) |
| `source-map-js` | high | [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) |
| `svgo` | high | [GHSA-2p49-hgcm-8545](https://github.com/advisories/GHSA-2p49-hgcm-8545), [GHSA-4vpr-x523-8j87](https://github.com/advisories/GHSA-4vpr-x523-8j87), [GHSA-w27v-7q3p-w38r](https://github.com/advisories/GHSA-w27v-7q3p-w38r), `css-select` |
| `underscore` | high | [GHSA-qpx9-hpmf-5gmw](https://github.com/advisories/GHSA-qpx9-hpmf-5gmw) |
| `webpack-dev-middleware` | high | [GHSA-g84c-rxfj-3j2c](https://github.com/advisories/GHSA-g84c-rxfj-3j2c) |
| `webpack-dev-server` | high | [GHSA-9jgg-88mc-972h](https://github.com/advisories/GHSA-9jgg-88mc-972h), [GHSA-4v9v-hfq4-rm2v](https://github.com/advisories/GHSA-4v9v-hfq4-rm2v), [GHSA-79cf-xcqc-c78w](https://github.com/advisories/GHSA-79cf-xcqc-c78w), [GHSA-mx8g-39q3-5c79](https://github.com/advisories/GHSA-mx8g-39q3-5c79), [GHSA-f5vj-f2hx-8m93](https://github.com/advisories/GHSA-f5vj-f2hx-8m93), [GHSA-m28w-2pqf-7qgj](https://github.com/advisories/GHSA-m28w-2pqf-7qgj), `sockjs`, `webpack-dev-middleware` |
| `workbox-build` | high | `rollup-plugin-terser` |
| `workbox-webpack-plugin` | high | `workbox-build` |
| `ws` | high | [GHSA-58qx-3vcg-4xpx](https://github.com/advisories/GHSA-58qx-3vcg-4xpx), [GHSA-96hv-2xvq-fx4p](https://github.com/advisories/GHSA-96hv-2xvq-fx4p) |
| `zod` | high | [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) |
| `baseline-browser-mapping` | moderate | [GHSA-w5vr-8v7q-w6rv](https://github.com/advisories/GHSA-w5vr-8v7q-w6rv) |
| `colord` | moderate | [GHSA-2wm5-q62r-hmrv](https://github.com/advisories/GHSA-2wm5-q62r-hmrv) |
| `css-minimizer-webpack-plugin` | moderate | `serialize-javascript` |
| `http-proxy-middleware` | moderate | [GHSA-64mm-vxmg-q3vj](https://github.com/advisories/GHSA-64mm-vxmg-q3vj) |
| `postcss-selector-parser` | moderate | [GHSA-w9m9-85wc-3x92](https://github.com/advisories/GHSA-w9m9-85wc-3x92), [GHSA-rj75-hqrm-r3gf](https://github.com/advisories/GHSA-rj75-hqrm-r3gf) |
| `qs` | moderate | [GHSA-q8mj-m7cp-5q26](https://github.com/advisories/GHSA-q8mj-m7cp-5q26), [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx), [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g), [GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw) |
| `react-router` | moderate | [GHSA-wrjc-x8rr-h8h6](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6), [GHSA-337j-9hxr-rhxg](https://github.com/advisories/GHSA-337j-9hxr-rhxg) |
| `react-router-dom` | moderate | `react-router` |
| `resolve-url-loader` | moderate | `postcss` |
| `sockjs` | moderate | `uuid` |
| `uuid` | moderate | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) |
| `@babel/core` | low | [GHSA-4x5r-pxfx-6jf8](https://github.com/advisories/GHSA-4x5r-pxfx-6jf8) |
| `@jest/core` | low | `jest-config`, `jest-runner` |
| `@tootallnate/once` | low | [GHSA-vpq2-c234-7xj6](https://github.com/advisories/GHSA-vpq2-c234-7xj6) |
| `http-proxy-agent` | low | `@tootallnate/once` |
| `jest` | low | `@jest/core`, `jest-cli` |
| `jest-cli` | low | `@jest/core`, `jest-config` |
| `jest-config` | low | `jest-environment-jsdom`, `jest-runner` |
| `jest-environment-jsdom` | low | `jsdom` |
| `jest-runner` | low | `jest-environment-jsdom` |
| `jsdom` | low | `http-proxy-agent` |

### Cloud Functions: all reported affected packages

| Package | npm severity | Direct advisories / affected dependency chain |
| --- | --- | --- |
| `body-parser` | high | [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828) |
| `@google-cloud/firestore` | moderate | `google-gax` |
| `@google-cloud/storage` | moderate | `retry-request`, `teeny-request` |
| `firebase-admin` | moderate | `@google-cloud/firestore`, `@google-cloud/storage` |
| `firebase-functions` | moderate | `firebase-admin` |
| `gaxios` | moderate | `uuid` |
| `google-gax` | moderate | `retry-request`, `uuid` |
| `retry-request` | moderate | `teeny-request` |
| `teeny-request` | moderate | `uuid` |
| `uuid` | moderate | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) |

Recheck advisories after remediation and verify installed/transitive versions, not only top-level semver ranges. A clean scanner result would still not resolve the authorization, quota, workflow, and privacy findings above.


