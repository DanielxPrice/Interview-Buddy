# DEPLOY-4 — Post-deployment validation plan and execution record

**Project:** Interview Buddy  
**Method:** GitHub Actions automated smoke checks + repeatable manual browser acceptance checks  
**Status:** Test definitions provided; execution evidence must be filled in after an actual deployment.

## A. Automated checks

The CD workflow executes `node scripts/smoke-test.mjs` twice:

1. `--backend-only` against the direct Cloud Run URL after API deployment.
2. Full suite against the live Firebase Hosting origin after frontend deployment.

| Check | Expected result | Implemented in script? |
|---|---|---|
| `/api/health` | HTTP 200; `status=ok`; exact source SHA and CI build version | Yes |
| `/api/questions/options` without a token | HTTP 401 with `auth-token-required` | Yes |
| `/api/questions/options` with invalid token | HTTP 401 with `invalid-auth-token` | Yes |
| `/deployment-info.json` via Hosting | HTTP 200; exact source SHA and CI build version | Yes |
| `/`, `/login`, `/register`, `/dashboard` | HTTP 200 and React HTML shell | Yes |

**Limitations:** Successful HTML fallback does not prove client-side rendering, that login actually works, or that a protected route redirects. HTTP protected-API checks do not prove Firestore connectivity or account ownership; those require separate authenticated tests.

Local manual invocation after deployment:

```bash
BASE_URL=https://interview-buddy-c9912.web.app \
EXPECTED_SHA=<full_40_character_commit_SHA> \
EXPECTED_VERSION=IB-build-<run>.<attempt>-<short_SHA> \
node scripts/smoke-test.mjs
```

In GitHub Actions, the workflow provides these values automatically from the CI run and produces a readable step summary. A failed check exits non-zero and fails the deployment job, but does **not** automatically roll back already-deployed resources.

## B. Browser smoke / acceptance checklist (manual)

Use an **incognito/private** browser window and a dedicated test account. Record pass/fail and screenshots or screen recording as appropriate.

| ID | Manual browser scenario | Expected result | Result / evidence |
|---|---|---|---|
| M01 | Load the production website | Login route renders; no Firebase initialization errors in browser console | [ ] |
| M02 | Visit `/login` and `/register` | Both pages render with expected authentication controls | [ ] |
| M03 | While logged out, visit `/dashboard` directly | Redirects/blocks protected UI, not just a successful HTTP shell | [ ] |
| M04 | Sign in using dedicated test credentials | Firebase Authentication succeeds; dashboard opens | [ ] |
| M05 | Start an interview setup | Mode, role, difficulty and tags UI works; database-backed options load | [ ] |
| M06 | Request questions and submit a supported answer | `/api/questions` or evaluation requests succeed using valid Firebase ID token; feedback appears where implemented | [ ] |
| M07 | Navigate through dashboard, interview, and logout | Client-side navigation works; logout removes access to protected routes | [ ] |
| M08 | Refresh a protected route while authenticated | App reloads and properly restores/handles authentication | [ ] |
| M09 | Force reload and inspect browser console/network | No critical errors, wrong API hostname, or missing Firebase environment configuration | [ ] |
| M10 | Open `/deployment-info.json` and `/api/health` | Versions/SHA match the successful CI run and each other | [ ] |

If results, history, ELO, or friends pages are still prototype-backed, identify that limitation in Jira and do not claim their real backend integration passed. This smoke plan covers deployment readiness, not the full feature acceptance suite.


## C. Known testing limitations

- CI smoke tests are HTTP/API checks, not automated browser E2E tests.
- Real login requires a valid Firebase test account and browser interaction; do not put credentials or ID tokens in repository code or GitHub Actions logs.
- A successful health request alone does not verify Firestore or the AI provider. Browser test M05/M06 or dedicated authenticated integration tests are needed.
- Passing CI does not equal passing production testing. Capture the actual deployment evidence.
