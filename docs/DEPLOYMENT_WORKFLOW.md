# DEPLOY-2 and DEPLOY-3 — Versioned deployment workflow

**Project:** Interview Buddy  
**Hosting:** Firebase Hosting (React) + Cloud Run (Express) + Firebase Auth/Firestore  
**Source-of-truth configuration:** `.github/workflows/ci.yml`, `.github/workflows/cd.yml`, `.github/workflows/firebase-hosting-pull-request.yml`, `firebase.json`

## Planned and implemented release flow

```text
Feature branch -> Pull request -> Peer review -> CI tests/build
    -> Merge to main -> Main CI: lint + tests + production React build
    -> Generate IB-build-<run>.<attempt>-<short SHA>
    -> Upload compiled React build as CI artifact
    -> CD runs only if successful push-to-main CI finished
    -> Checkout exact CI SHA and download exact React build artifact
    -> Deploy backend source from same SHA to Cloud Run
    -> Verify Cloud Run health, revision ID and unauthenticated API rejection
    -> Deploy CI-built React artifact to Firebase Hosting live channel
    -> Verify web app shell, API, protected endpoint and both revisions
    -> Save GitHub Actions step summary and complete manual browser checklist
```

## Release gate and production approval

- PRs are validated by `.github/workflows/ci.yml`; a code-review/approval requirement must be enabled under GitHub branch protection or repository rulesets (not enforced by the workflow itself).
- The CD job checks `workflow_run.conclusion == success`, `workflow_run.event == push`, and branch `main`. Failed CI runs cannot deploy through this CD workflow.
- Production deployment is **automatic** after passing main CI in the current configuration. There is no manual production approval gate. If the team wants one, configure a protected GitHub **production environment** and add `environment: production` to the CD job before claiming approval is required.
- Credentials are made available to CD through GitHub Actions secrets/variables and Workload Identity Federation. Do not expose them in build artifacts or documents.

## Build traceability

- CI build ID: `IB-build-<CI run number>.<attempt>-<first 7 SHA characters>`.
- The CI artifact is named `interview-buddy-frontend`, and embeds a public `deployment-info.json` (build ID, full SHA, CI run ID/attempt).
- CD downloads that exact artifact using the triggering CI run ID. It does **not** rebuild React.
- Cloud Run is built and deployed from that same source commit and receives `BUILD_VERSION` and `SOURCE_COMMIT_SHA` environment values.
- API `/api/health` returns these metadata fields (no secrets).
- Smoke tests verify the backend metadata and `/deployment-info.json` are identical to the triggering CI build.
- The backend is still built **from source** by Cloud Build during CD, not reused as a container image created by CI. The matched source SHA and deployed metadata make that distinction explicit.

## Pull-request preview decision

- Same-repository PRs get a temporary **Firebase Hosting frontend preview** from `.github/workflows/firebase-hosting-pull-request.yml`.
- The workflow validates the six `REACT_APP_FIREBASE_*` variables before building.
- The project has **no dedicated independent staging backend or Firestore staging project** in this repository. Hosting previews may point to the current shared Cloud Run service/Firebase project; use test accounts and avoid modifying valuable production records.
- External fork PRs intentionally do not run the privileged preview job because Firebase deployment credentials must not be provided to untrusted forks.

## GitHub configuration (verify in repository settings)

| Name | Type | Used for |
|---|---|---|
| `REACT_APP_FIREBASE_API_KEY` | Variable | Public Firebase Web SDK config |
| `REACT_APP_FIREBASE_AUTH_DOMAIN` | Variable | Public Firebase Web SDK config |
| `REACT_APP_FIREBASE_PROJECT_ID` | Variable | Public Firebase Web SDK config |
| `REACT_APP_FIREBASE_STORAGE_BUCKET` | Variable | Public Firebase Web SDK config |
| `REACT_APP_FIREBASE_MESSAGING_SENDER_ID` | Variable | Public Firebase Web SDK config |
| `REACT_APP_FIREBASE_APP_ID` | Variable | Public Firebase Web SDK config |
| `GCP_PROJECT_ID` | Variable | Google Cloud project / Firebase Admin project |
| `GCP_REGION` | Variable | Cloud Run deployment region (`us-west1`) |
| `GCP_WIF_PROVIDER` | Variable | Google Workload Identity Federation provider resource |
| `GCP_DEPLOY_SERVICE_ACCOUNT` | Variable | IAM deployment identity email |
| `CLOUD_RUN_RUNTIME_SERVICE_ACCOUNT` | Variable | Cloud Run runtime identity email |
| `FRONTEND_ORIGIN` | Variable | Live HTTPS origin without trailing slash |
| `FIREBASE_SERVICE_ACCOUNT_INTERVIEW_BUDDY_C9912` | **Secret** | Firebase Hosting deployment service-account JSON |
| `GITHUB_TOKEN` | Built-in secret | GitHub API / CI artifact download / preview PR interaction |

`REACT_APP_API_BASE_URL` is set to `/api` inside the workflows; it is **not** a GitHub variable. API-provider credentials must never use a `REACT_APP_*` prefix. The current backend retrieves the AI key from its configured Firestore server settings; confirm the runtime service account can access the required document.

### IAM and Cloud Run checks

1. Verify the GitHub deployment identity can deploy Cloud Run from source and act as the configured runtime identity. Use the least permissions required for that service.
2. Verify the **Cloud Build build service account** has Cloud Run Builder and required build/storage/artifact permissions; source deployment uses Cloud Build under the hood. This is separate from the Cloud Run *runtime* service account.
3. Verify the Cloud Run runtime identity can read/write required Firestore records, and relevant AI configuration.
4. Verify Cloud Run API requests through Firebase Hosting rewrites can reach the service. The current CD also checks the direct Cloud Run URL, which requires an appropriately accessible endpoint.
5. Verify the Firebase deploy account has Firebase Hosting Admin and Cloud Run Viewer; the preview action may also require Firebase Authentication Admin / API Keys Viewer.
6. Ensure Firebase Hosting `/api/**` rewrite region (`us-west1`) matches `GCP_REGION`.
7. Configure Google Cloud billing alerts and review runtime limits.

## How to deploy/redeploy

1. Submit and peer-review a PR against `main`.
2. Verify CI is green and merge to `main`.
3. Open GitHub Actions > **CI Pipeline** and confirm the main-branch run passes and uploads `interview-buddy-frontend`.
4. Open **Deploy Production** triggered by that exact run. Verify backend deployment, frontend deployment and both smoke checks pass.
5. Read the GitHub Actions job summary to capture CI build ID, SHA, API URL, live frontend URL, and validation results.
6. Complete the browser checklist in `docs/POST_DEPLOYMENT_VALIDATION.md` and attach evidence to Jira.
7. To redeploy the same source, rerun CI for that commit and verify the new CD run (new CI attempt has a distinct build ID). Do not assume redeployment succeeds until validated.

## Failure, incident, and rollback guidance

- **CI fails:** no deployment should occur; fix/tests and merge a new commit.
- **Cloud Run source build fails:** inspect Cloud Build history, deployer permissions, and build-service-account IAM roles. Do not assume the runtime service-account permissions fix build failures.
- **Firebase Hosting deploy fails:** check the Hosting service account secret and Firebase Hosting permissions.
- **Smoke check fails:** CD job reports failure; a prior deployment step might already have changed a live service. Do **not** infer automatic rollback. Inspect the GitHub summary and restore a previously tested release manually if required.
- **Rollback:** redeploy the last known-good code/release following the team-approved release procedure. If using Firebase Hosting release history or Cloud Run revision traffic shifts, verify frontend/backend versions still match; document the chosen revision and retest.
- **Secrets incident:** rotate affected credentials in Firebase/Google Cloud/GitHub and revalidate service access; never attach secret values to Jira.

