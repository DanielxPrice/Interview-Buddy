# Interview Buddy deployment and validation

Interview Buddy uses Firebase Hosting for the React SPA and Google Cloud Run for its Express API. The `/api/**` Hosting rewrite connects the frontend to the backend. GitHub Actions handles CI, pull-request frontend previews and production CD.

- [Hosting options and architecture decision (DEPLOY-1)](docs/DEPLOYMENT_HOSTING_DECISION.md)
- [Versioned deployment workflow and setup (DEPLOY-2, DEPLOY-3)](docs/DEPLOYMENT_WORKFLOW.md)
- [Automated and browser smoke testing (DEPLOY-4)](docs/POST_DEPLOYMENT_VALIDATION.md)

The production pipeline publishes the frontend artifact produced by passing main-branch CI, deploys the Cloud Run API from the same commit, and verifies matching build metadata after deployment. Run `node scripts/smoke-test.mjs` with the environment variables described in the validation document when checking a live deployment.

---

# Getting Started with Create React App

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

### Code Splitting

This section has moved here: [https://facebook.github.io/create-react-app/docs/code-splitting](https://facebook.github.io/create-react-app/docs/code-splitting)

### Analyzing the Bundle Size

This section has moved here: [https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size](https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size)

### Making a Progressive Web App

This section has moved here: [https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app](https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app)

### Advanced Configuration

This section has moved here: [https://facebook.github.io/create-react-app/docs/advanced-configuration](https://facebook.github.io/create-react-app/docs/advanced-configuration)

### Deployment

This section has moved here: [https://facebook.github.io/create-react-app/docs/deployment](https://facebook.github.io/create-react-app/docs/deployment)

### `npm run build` fails to minify

This section has moved here: [https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify](https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify)


## Firebase-backed interview questions

The prototype includes a backend question API that reads from Firebase Cloud Firestore instead of hardcoding interview prompts in `InterviewSessionPage.js`.

See [`FIREBASE_SETUP.md`](FIREBASE_SETUP.md) for Firebase credentials, seeding, and local run instructions. The React page calls the existing `src/services/interviewService.js` facade, which talks to the Express application layer; the browser does not access Firestore or quiz answer keys directly.

Code Style and Theoretical Style now use the main branch's provider-independent AI service and repository layers for weighted evaluation. See [`AI_GRADING_SETUP.md`](AI_GRADING_SETUP.md) for the request flow, private rubric schema, and provider configuration.

## Repository/data-access layer

The Firebase backend now uses explicit repository contracts and concrete Firestore adapters. Express routes do not call Firestore directly.

See [`REPOSITORY_ARCHITECTURE.md`](REPOSITORY_ARCHITECTURE.md) for the acceptance-criteria mapping and [`FIREBASE_SETUP.md`](FIREBASE_SETUP.md) for configuration instructions.
