# DEPLOY-1 — Hosting options evaluation and decision

**Project:** Interview Buddy (CPSC 491-05, Fall 2026)  
**Status:** Architecture implemented in repository; team approval/evidence to be recorded below  
**Reviewed source:** Interview-Buddy-main (10), October 8, 2026

## Application requirements

- React/Create React App SPA with client-side routes; needs HTTPS, static content hosting, and fallback of client-side paths to `index.html`.
- Node.js 24 / Express backend; authenticated `/api/questions`, `/api/evaluate`, and `/api/users` endpoints.
- Firebase Authentication web SDK plus Firebase Admin SDK on the backend, with Cloud Firestore repositories.
- Environment-specific public React web configuration at **build time**; protected backend credentials never bundled in React.
- GitHub pull-request checks, automated CI builds, and gated production deployment after a successful main-branch build.
- Repeatable deployment with a source commit and build identifier, limited operating complexity, and manageable costs.

## Hosting options considered

| Evaluation | Firebase Hosting + Cloud Run (selected) | Vercel frontend + Cloud Run backend | Render static frontend + Render Node service |
|---|---|---|---|
| React SPA | Supported with `index.html` fallback | Supported; SPA rewrite configuration | Supported; SPA rewrite configuration |
| Node.js/Express | Full service on Cloud Run | Full service on Cloud Run | Managed Node web service |
| Firebase compatibility | Native Google Cloud/Firebase project integration | Firebase client supported; backend still uses Admin credentials/service identity | Firebase client supported; backend needs credentials/service identity |
| GitHub integration | GitHub Actions and Firebase deploy action | GitHub integration or Actions + Cloud Run | GitHub-based automatic or manual deploys |
| Environment variables | GitHub Actions vars for React build; Cloud Run runtime env | Separate Vercel build vars and Cloud Run env | Render build/runtime configuration per service |
| Secret management | Google Cloud identities; GitHub Actions OIDC; Firebase deploy service-account secret | Vercel plus Google Cloud identities | Render service environment/secrets; credentials for Firebase Admin |
| Automated deployment | Existing CI and CD YAML in this repository | Requires combining two service deployment routes | Managed Git-triggered deploys or Actions integration |
| Cost | Usage-based; review Firebase/Cloud Run billing and Cloud Build usage | Two vendors and Cloud Run charges; verify current plan limits | Plan-based and usage-related charges; verify current Render plans |
| Maintenance | Moderate: one Google Cloud/Firebase project, two deployment targets, IAM setup | Higher: split domains/permissions and two providers | Moderate: one hosting provider, plus Firebase/Google Cloud services |

**Cost note:** No fixed monthly amount is claimed. Actual billing depends on usage, region, tier, storage, Cloud Build, AI usage, and active resources. Before launch, check current provider prices and enable a billing budget alert.

## Selected approach and rationale

**Selected:** Firebase Hosting for the React SPA, Google Cloud Run for the Express API, Firebase Authentication and Firestore for identity/data, and GitHub Actions for CI/CD.

Reasons:

1. The team's existing Firestore/Firebase Authentication integration can stay unchanged.
2. `firebase.json` uses `/api/**` rewrites to the `interview-buddy-api` Cloud Run service in `us-west1`, avoiding a second browser API hostname in production.
3. The existing GitHub Actions workflows already cover tests, preview channels, Cloud Run and Hosting deployment.
4. Cloud Run provides a managed Node.js deployment without the team administering a virtual machine.
5. Source SHA and CI build metadata can be checked after deployment.

## Required project configuration

- Firebase project alias: `interview-buddy-c9912` in `.firebaserc`.
- Hosting public folder: `build` and Cloud Run rewrite to `interview-buddy-api`, `us-west1` in `firebase.json`.
- Cloud Run region configuration `GCP_REGION` must equal `us-west1` (or the `firebase.json` rewrite must be updated to match).
- Backend configuration includes `FIREBASE_PROJECT_ID`, `CLIENT_ORIGIN`, AI provider configuration and runtime identity with Firestore access.
- Cloud Run source-build identity requires appropriate Cloud Build permissions; the GitHub Actions deployment identity requires Cloud Run deployment rights.

## Decision and approval record

- **Decision date:** 10/5/2026
- **Approved by:** Everyone in the group
- **Jira issue:** [\[link DEPLOY-1\]](https://csuf491.atlassian.net/browse/SCRUM-199?atlOrigin=eyJpIjoiMWNjYWQ5MTZmNjA0NDY1Njk3ZDQ4NmFlOGUyNDc1N2MiLCJwIjoiaiJ9)
- **Billing budget/owner:** $20/Hoonam Awad

## Official platform references

- Firebase Hosting: https://firebase.google.com/docs/hosting/quickstart
- Hosting + Cloud Run: https://firebase.google.com/docs/hosting/cloud-run
- Cloud Run source deployment/IAM: https://cloud.google.com/run/docs/deploying-source-code
- Vercel deployment: https://vercel.com/docs/deployments
- Render services: https://render.com/docs/web-services
- Firebase pricing: https://firebase.google.com/pricing
- Cloud Run pricing: https://cloud.google.com/run/pricing
- Vercel pricing: https://vercel.com/pricing
- Render pricing: https://render.com/pricing
