# Run This Project

## Prerequisites

- Node.js 18 or newer
- npm 9 or newer
- A Firebase project with Cloud Firestore enabled for database-backed interview questions

## 1. Install the React client

From the project root:

```bash
npm install
```

Copy the client environment template:

```bash
cp .env.example .env.local
```

## 2. Configure the backend

```bash
cd server
npm install
cp .env.example .env
```

Edit `server/.env` and set `FIREBASE_PROJECT_ID`.

Point `GOOGLE_APPLICATION_CREDENTIALS` to a Firebase service-account JSON file stored outside the repository.

If you are testing AI answer evaluation, also set `ANTHROPIC_API_KEY` in `server/.env`.

See `FIREBASE_SETUP.md` for full credential and repository-layer details.

## 3. Test and seed Firebase

From `server/`:

```bash
npm test
npm run seed
```

The seed script writes through `QuestionRepository`; it does not access Firestore directly.

## 4. Start both processes

Terminal 1, from `server/`:

```bash
npm start
```

Terminal 2, from the project root:

```bash
npm start
```

Open `http://localhost:3000`.

The backend defaults to `http://localhost:5001`.

## Architecture note

The client never accesses Firestore directly. The current flow is:

```text
React -> interviewService -> Express route -> repository contract -> Firestore adapter -> Firestore
```
