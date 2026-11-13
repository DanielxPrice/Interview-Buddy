
"use strict";

// CI/CD-20 (SCRUM-187): HTTP -> Firebase Authentication -> Firestore session
// integration tests. They use REAL Firebase Admin SDK transactions against the
// LOCAL Firebase emulators; neither Firestore nor Firebase Auth is mocked.
const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

const PROJECT_ID = "demo-interview-buddy-tests";

function localEmulator(name) {
  const raw = process.env[name];
  if (!raw || !/^(localhost|127\.0\.0\.1|\[::1\]):[0-9]{1,5}$/.test(raw)) {
    throw new Error(`${name} must point to a local Firebase emulator (host:port). Production access is forbidden.`);
  }
  const url = new URL(`http://${raw}`);
  if (Number(url.port) < 1 || Number(url.port) > 65535) {
    throw new Error(`${name} has an invalid port.`);
  }
  return url;
}

const firestoreEmulator = localEmulator("FIRESTORE_EMULATOR_HOST");
const authEmulator = localEmulator("FIREBASE_AUTH_EMULATOR_HOST");
for (const name of ["GCLOUD_PROJECT", "FIREBASE_PROJECT_ID", "GOOGLE_CLOUD_PROJECT"]) {
  if (process.env[name] && process.env[name] !== PROJECT_ID) {
    throw new Error(`${name} must equal ${PROJECT_ID} for emulator integration tests.`);
  }
  process.env[name] = PROJECT_ID;
}
if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  throw new Error("CI/CD-20 refuses to run with production Firebase credentials in the environment.");
}

const express = require("express");
const request = require("supertest");
// Initialize the default app without credentials: emulator integration does
// not need (and must not use) a production service account.
const admin = require("firebase-admin");
admin.initializeApp({ projectId: PROJECT_ID });
const { db } = require("../src/firebaseAdmin");
const requireAuth = require("../src/middleware/requireAuth");
const createSessionRouter = require("../src/routes/sessions");
const SessionRepository = require("../src/repositories/firestore/FirestoreSessionRepository");
const QuestionRepository = require("../src/repositories/firestore/FirestoreQuestionRepository");
const UserRepository = require("../src/repositories/firestore/FirestoreUserRepository");

const sessions = new SessionRepository({ db, admin });
const questions = new QuestionRepository({ db, admin });
const users = new UserRepository({ db, admin });
const api = express();
api.use(express.json());
api.use("/api/sessions", requireAuth, createSessionRouter({
  sessionRepository: sessions,
  questionRepository: questions,
}));
api.use((error, _req, res, _next) => {
  res.status(500).json({ error: "Unexpected integration-test failure", detail: error.message });
});

const quiz = {
  id: "cicd20-quiz-01",
  mode: "Quiz Style",
  active: true,
  prompt: "What does HTTP 200 mean?",
  options: ["Success", "Not Found", "Server Error"],
  correctAnswer: "Success",
  explanation: "HTTP 200 indicates success.",
  tags: ["web"],
  difficulty: "Beginner",
  topic: "HTTP",
};
const quiz2 = {
  ...quiz,
  id: "cicd20-quiz-02",
  prompt: "Which method retrieves a resource?",
  options: ["GET", "POST", "DELETE"],
  correctAnswer: "GET",
};

function setup(count = 1) {
  return {
    mode: "Quiz Style", jobRole: "Backend Developer",
    experienceLevel: "Beginner", tags: ["web"], questionCount: count,
  };
}

async function resetFirestore() {
  const url = new URL(`/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, firestoreEmulator);
  const response = await fetch(url, { method: "DELETE", signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, `Firestore emulator reset failed: ${await response.text()}`);
}

async function createUser(t) {
  const uid = `cicd20-${randomUUID()}`;
  const email = `${uid}@example.test`;
  const password = `EmulatorOnly!${randomUUID()}`;
  await admin.auth().createUser({ uid, email, password, emailVerified: true });
  t.after(async () => { await admin.auth().deleteUser(uid); });
  await users.createProfile({ uid, email, username: `User_${uid.replaceAll("-", "").slice(0, 22)}` });

  // A genuine Auth Emulator ID token, checked by the production requireAuth
  // middleware. No fake req.user or mocked verifyIdToken is used.
  const signIn = new URL("/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-only", authEmulator);
  const response = await fetch(signIn, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, 200, `Auth emulator sign-in failed: ${await response.text()}`);
  const { idToken } = await response.json();
  assert.ok(idToken, "Auth Emulator must issue an actual ID token");
  return { uid, token: idToken };
}

function asUser(user) {
  return { Authorization: `Bearer ${user.token}` };
}

async function startSession(user, count = 1) {
  const result = await request(api).post("/api/sessions")
    .set(asUser(user)).send(setup(count));
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(result.body.userId, user.uid);
  assert.equal(result.body.status, "active");
  return result.body;
}

async function assign(session, user, selected = [quiz]) {
  return sessions.assignQuestions({
    sessionId: session.id, userId: user.uid,
    setup: setup(selected.length), questions: selected,
  });
}

async function answer(user, session, question = quiz, choice = "Success") {
  return request(api).post(`/api/sessions/${session.id}/quiz-answers`)
    .set(asUser(user)).send({ questionId: question.id, answer: choice });
}

async function finish(user, session) {
  return request(api).patch(`/api/sessions/${session.id}/complete`)
    .set(asUser(user)).send({});
}

async function seedQuestions() {
  await db.collection("questions").doc(quiz.id).set(quiz);
  await db.collection("questions").doc(quiz2.id).set(quiz2);
}

beforeEach(async () => {
  await resetFirestore();
  await seedQuestions();
});

after(async () => {
  try {
    await resetFirestore();
  } finally {
    await db.terminate();
    await admin.app().delete();
  }
});

test("CI20-01: requests without a verified Firebase token cannot create sessions", async () => {
  const response = await request(api).post("/api/sessions").send(setup());
  assert.equal(response.status, 401);
  assert.equal((await db.collection("sessions").get()).size, 0);
});

test("CI20-02: authenticated creation persists owner, configuration, daily usage and active slot", async (t) => {
  const user = await createUser(t);
  const session = await startSession(user);
  const saved = (await db.collection("sessions").doc(session.id).get()).data();
  assert.equal(saved.userId, user.uid);
  assert.equal(saved.mode, "Quiz Style");
  assert.equal(saved.questionCount, 1);
  assert.equal(saved.assignmentStatus, "pending");
  assert.equal(saved.activeSlotId, "slot-0");
  assert.ok(saved.createdAt.toDate() instanceof Date);
  const usage = await db.collection("users").doc(user.uid).collection("sessionCreationUsage").get();
  assert.equal(usage.size, 1);
  assert.equal(usage.docs[0].data().created, 1);
  const slot = await db.collection("users").doc(user.uid).collection("activeSessionSlots").doc("slot-0").get();
  assert.equal(slot.data().sessionId, session.id);
  const retrieved = await request(api).get(`/api/sessions/${session.id}`).set(asUser(user));
  assert.equal(retrieved.status, 200);
  assert.equal(retrieved.body.userId, user.uid);
});

test("CI20-03: frozen question assignment persists only public question fields", async (t) => {
  const user = await createUser(t);
  const session = await startSession(user);
  const first = await assign(session, user);
  assert.deepEqual(first.map((item) => item.id), [quiz.id]);
  const repeat = await assign(session, user);
  assert.deepEqual(repeat, first);
  const saved = (await sessions.findById(session.id));
  assert.deepEqual(saved.assignedQuestionIds, [quiz.id]);
  assert.equal(saved.assignmentStatus, "assigned");
  assert.equal(saved.assignedQuestions[0].correctAnswer, undefined);
  assert.equal(saved.assignedQuestions[0].explanation, undefined);
  assert.equal(saved.assignedQuestions[0].prompt, quiz.prompt);
});

test("CI20-04: real Quiz submission saves one graded response; duplicate is rejected", async (t) => {
  const user = await createUser(t);
  const session = await startSession(user);
  await assign(session, user);
  const first = await answer(user, session);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.isCorrect, true);
  const persisted = await sessions.listResponses(session.id);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].candidateResponse, "Success");
  assert.equal(persisted[0].evaluation.score, 100);
  const duplicate = await answer(user, session);
  assert.equal(duplicate.status, 409);
  assert.equal((await sessions.listResponses(session.id)).length, 1);
});

test("CI20-05: completed interview atomically persists results, points, ELO and result retrieval", async (t) => {
  const user = await createUser(t);
  const session = await startSession(user);
  await assign(session, user);
  assert.equal((await answer(user, session)).status, 200);
  const completed = await finish(user, session);
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  assert.equal(completed.body.result.score, 100);
  assert.equal(completed.body.result.completionStatus, "completed");
  assert.equal(completed.body.result.rankEligible, true);
  assert.equal(completed.body.eloChange, "+16");
  const persisted = await sessions.findById(session.id);
  assert.equal(persisted.status, "completed");
  assert.equal(persisted.result.previousElo, 1000);
  assert.equal(persisted.result.newElo, 1016);
  assert.equal(persisted.result.eloChange, "+16");
  assert.ok(persisted.completedAt.toDate() instanceof Date);
  const profile = (await db.collection("users").doc(user.uid).get()).data();
  assert.equal(profile.ranking.points, 100);
  assert.equal(profile.ranking.rankedSessions, 1);
  assert.equal(profile.ranking.elo, 1016);
  const storedResults = await request(api).get(`/api/sessions/${session.id}/results`).set(asUser(user));
  assert.equal(storedResults.status, 200, JSON.stringify(storedResults.body));
  assert.equal(storedResults.body.result.score, 100);
  assert.equal(storedResults.body.breakdownAvailable, true);
  assert.equal(storedResults.body.breakdown.length, 1);
  assert.equal(storedResults.body.breakdown[0].userAnswer, "Success");
  assert.equal(storedResults.body.eloChange, "+16");
});

test("CI20-06: incorrect answer persists zero score and lowers ELO", async (t) => {
  const user = await createUser(t);
  const session = await startSession(user);
  await assign(session, user);
  const response = await answer(user, session, quiz, "Not Found");
  assert.equal(response.status, 200);
  assert.equal(response.body.isCorrect, false);
  const completed = await finish(user, session);
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  assert.equal(completed.body.result.score, 0);
  assert.equal(completed.body.result.eloChange, "-16");
  const profile = (await db.collection("users").doc(user.uid).get()).data();
  assert.equal(profile.ranking.points, 0);
  assert.equal(profile.ranking.rankedSessions, 1);
  assert.equal(profile.ranking.elo, 984);
});

test("CI20-07: repeated completion is idempotent and does not award ranking twice", async (t) => {
  const user = await createUser(t);
  const session = await startSession(user);
  await assign(session, user);
  assert.equal((await answer(user, session)).status, 200);
  const first = await finish(user, session);
  assert.equal(first.status, 200);
  const before = await sessions.findById(session.id);
  const again = await finish(user, session);
  assert.equal(again.status, 200);
  const afterSaved = await sessions.findById(session.id);
  const profile = (await db.collection("users").doc(user.uid).get()).data();
  assert.deepEqual(afterSaved.result, before.result);
  assert.equal(afterSaved.completedAt.toMillis(), before.completedAt.toMillis());
  assert.equal(profile.ranking.points, 100);
  assert.equal(profile.ranking.rankedSessions, 1);
  assert.equal(profile.ranking.elo, 1016);
  assert.equal(again.body.eloChange, "+16");
});

test("CI20-08: partial completion persists partial result without ranking credit", async (t) => {
  const user = await createUser(t);
  const session = await startSession(user, 2);
  await assign(session, user, [quiz, quiz2]);
  assert.equal((await answer(user, session)).status, 200);
  const completed = await finish(user, session);
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  assert.equal(completed.body.result.score, 50);
  assert.equal(completed.body.result.questionsUnanswered, 1);
  assert.equal(completed.body.result.completionStatus, "partial");
  assert.equal(completed.body.result.rankEligible, false);
  assert.equal(completed.body.eloChange, null);
  const profile = (await db.collection("users").doc(user.uid).get()).data();
  assert.equal(profile.ranking.points, 0);
  assert.equal(profile.ranking.rankedSessions, 0);
  assert.equal(profile.ranking.elo, 1000);
});

test("CI20-09: abandoned session persists no credit and releases its active slot", async (t) => {
  const user = await createUser(t);
  const session = await startSession(user);
  const completed = await finish(user, session);
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  assert.equal(completed.body.result.completionStatus, "abandoned");
  assert.equal(completed.body.result.rankEligible, false);
  const slot = await db.collection("users").doc(user.uid)
    .collection("activeSessionSlots").doc(session.activeSlotId).get();
  assert.equal(slot.exists, false);
  const profile = (await db.collection("users").doc(user.uid).get()).data();
  assert.equal(profile.ranking.rankedSessions, 0);
  assert.equal(profile.ranking.elo, 1000);
});

test("CI20-10: real Firebase identities cannot read, answer, finish or retrieve another user's session", async (t) => {
  const owner = await createUser(t);
  const attacker = await createUser(t);
  const session = await startSession(owner);
  await assign(session, owner);
  const before = (await db.collection("sessions").doc(session.id).get()).data();
  assert.equal((await request(api).get(`/api/sessions/${session.id}`).set(asUser(attacker))).status, 403);
  assert.equal((await request(api).get(`/api/sessions/${session.id}/results`).set(asUser(attacker))).status, 403);
  assert.equal((await answer(attacker, session)).status, 403);
  assert.equal((await finish(attacker, session)).status, 403);
  assert.deepEqual((await db.collection("sessions").doc(session.id).get()).data(), before);
  assert.equal((await sessions.listResponses(session.id)).length, 0);
});

test("CI20-11: completed history lists only its owner and survives new repository reads", async (t) => {
  const owner = await createUser(t);
  const other = await createUser(t);
  const owned = await startSession(owner);
  const foreign = await startSession(other);
  await assign(owned, owner);
  await assign(foreign, other);
  assert.equal((await answer(owner, owned)).status, 200);
  assert.equal((await answer(other, foreign)).status, 200);
  assert.equal((await finish(owner, owned)).status, 200);
  assert.equal((await finish(other, foreign)).status, 200);
  const history = await request(api).get("/api/sessions?status=completed").set(asUser(owner));
  assert.equal(history.status, 200, JSON.stringify(history.body));
  assert.deepEqual(history.body.map((item) => item.id), [owned.id]);
  const page = await request(api).get("/api/sessions?status=completed&pageSize=1").set(asUser(owner));
  assert.equal(page.status, 200);
  assert.deepEqual(page.body.sessions.map((item) => item.id), [owned.id]);
  assert.equal(page.body.nextCursor, null);
  const reloaded = new SessionRepository({ db, admin });
  assert.deepEqual((await reloaded.listCompletedByUser(owner.uid)).map((item) => item.id), [owned.id]);
});

test("CI20-12: invalid saved scoring data rolls back completion and ranking transaction", async (t) => {
  const user = await createUser(t);
  const session = await startSession(user);
  await assign(session, user);
  await db.collection("sessions").doc(session.id).collection("responses").doc(quiz.id).set({
    questionId: quiz.id, mode: "Quiz Style", candidateResponse: "Success",
    evaluation: { score: -1 },
  });
  const failure = await finish(user, session);
  assert.equal(failure.status, 409, JSON.stringify(failure.body));
  const persisted = await sessions.findById(session.id);
  assert.equal(persisted.status, "active");
  assert.equal(persisted.completedAt, null);
  const profile = (await db.collection("users").doc(user.uid).get()).data();
  assert.equal(profile.ranking.points, 0);
  assert.equal(profile.ranking.rankedSessions, 0);
  assert.equal(profile.ranking.elo, 1000);
});

test("CI20-13: completing an expired answered interview grants no ranking credit", async (t) => {
  const user = await createUser(t);
  const session = await startSession(user);
  await assign(session, user);
  assert.equal((await answer(user, session)).status, 200);
  await db.collection("sessions").doc(session.id).update({ activeExpiresAtMs: Date.now() - 1000 });
  const completed = await finish(user, session);
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  assert.equal(completed.body.result.score, 100);
  assert.equal(completed.body.result.rankEligible, false);
  assert.equal(completed.body.eloChange, null);
  const profile = (await db.collection("users").doc(user.uid).get()).data();
  assert.equal(profile.ranking.rankedSessions, 0);
  assert.equal(profile.ranking.elo, 1000);
});
