"use strict";

// SCRUM-215 + SCRUM-190: real Firestore SDK integration, not mocked SDK calls.
// Run ONLY through Firebase emulators:exec (auth,firestore) using a demo project.
const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

const PROJECT_ID = "demo-interview-buddy-tests";
const host = process.env.FIRESTORE_EMULATOR_HOST;
// Refuse any operation without explicit LOCAL emulator targeting.
if (!host || host.includes("/") || host.includes("@") || host.includes("?")) {
  throw new Error("A local FIRESTORE_EMULATOR_HOST is required. Production Firestore is forbidden.");
}
const emulator = new URL(`http://${host}`);
if (!["localhost", "127.0.0.1", "[::1]"].includes(emulator.hostname) ||
    !emulator.port || emulator.username || emulator.password) {
  throw new Error("Refusing non-local Firestore Emulator endpoint.");
}
for (const name of ["GCLOUD_PROJECT", "FIREBASE_PROJECT_ID"]) {
  if (process.env[name] && process.env[name] !== PROJECT_ID) {
    throw new Error(`${name} must equal ${PROJECT_ID} when running emulator tests.`);
  }
  process.env[name] = PROJECT_ID;
}

// Authenticated and simulated-claim testing requires the LOCAL Auth Emulator.
// A missing or non-local endpoint must fail before creating any test users.
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!authHost || authHost.includes("/") || authHost.includes("@") || authHost.includes("?")) {
  throw new Error("A local FIREBASE_AUTH_EMULATOR_HOST is required. Production Auth is forbidden.");
}
const authEmulator = new URL(`http://${authHost}`);
if (!["localhost", "127.0.0.1", "[::1]"].includes(authEmulator.hostname) ||
    !authEmulator.port || authEmulator.username || authEmulator.password) {
  throw new Error("Refusing non-local Firebase Auth Emulator endpoint.");
}

// Anonymous and authenticated Web SDK requests must obey firestore.rules.
// Admin SDK fixtures bypass client rules. The React app already depends on firebase.
const { initializeApp: initializeClientApp, deleteApp: deleteClientApp } = require("firebase/app");
const {
  getAuth: getClientAuth, connectAuthEmulator, signInWithEmailAndPassword,
  getIdTokenResult, signOut,
} = require("firebase/auth");
const {
  getFirestore: getClientFirestore, connectFirestoreEmulator,
  doc: clientDoc, collection: clientCollection,
  getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  terminate: terminateClientFirestore,
} = require("firebase/firestore");
const { assertOwnedActiveSession } = require("../src/services/sessionAssignmentPolicy");

const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");
const QuestionRepository = require("../src/repositories/firestore/FirestoreQuestionRepository");
const QuestionCatalogRepository = require("../src/repositories/firestore/FirestoreQuestionCatalogRepository");
const SessionRepository = require("../src/repositories/firestore/FirestoreSessionRepository");
const EvaluationRepository = require("../src/repositories/firestore/FirestoreEvaluationRepository");
const { selectQuestions } = require("../src/services/questionSelection");
const { validateQuestion } = require("../scripts/validateQuestionSeed");
const seed = require("../seed/questions.json");

const app = admin.initializeApp({ projectId: PROJECT_ID }, `emulator-test-${randomUUID()}`);
// A separate, non-Admin client proves the actual Firestore rule decisions.
const clientConfig = {
  apiKey: "emulator-test-only-key",
  authDomain: "demo-interview-buddy-tests.firebaseapp.com",
  projectId: PROJECT_ID,
  appId: "1:1234567890:web:emulator-only",
};
const clientApp = initializeClientApp(clientConfig, `unauthenticated-firestore-client-${randomUUID()}`);
const clientDb = getClientFirestore(clientApp);
connectFirestoreEmulator(clientDb, emulator.hostname.replaceAll("[", "").replaceAll("]", ""), Number(emulator.port));

const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });
const questions = new QuestionRepository({ db, admin });
const catalog = new QuestionCatalogRepository({ db });
const sessions = new SessionRepository({ db, admin });
const evaluations = new EvaluationRepository({ db, admin });
const resetUrl = new URL(
  `/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, emulator
);

function sample(mode) {
  return structuredClone(seed.find((question) => question.mode === mode));
}
const quiz = sample("Quiz Style");
const theory = sample("Theoretical Style");
const code = sample("Code Style");

// Task 1 / H-SOC-03,04,06: Real Firebase Auth SDK identities, including claims,
// using only local Auth + Firestore emulators. No production credentials are used.
async function createAuthenticatedContext(t, { role } = {}) {
  const uid = `soc-user-${randomUUID()}`;
  const email = `${uid}@example.invalid`;
  const password = `Emulator-only-${randomUUID()}`;
  const authAdmin = admin.auth(app);
  await authAdmin.createUser({ uid, email, password });
  if (role) {
    await authAdmin.setCustomUserClaims(uid, { role });
  }

  const webApp = initializeClientApp(clientConfig, `authenticated-firestore-client-${uid}`);
  const webAuth = getClientAuth(webApp);
  connectAuthEmulator(webAuth, authEmulator.origin, { disableWarnings: true });
  const webDb = getClientFirestore(webApp);
  connectFirestoreEmulator(webDb,
    emulator.hostname.replaceAll("[", "").replaceAll("]", ""), Number(emulator.port));

  // Clean up both client connections and emulator-created accounts even if an
  // assertion fails. Unique UIDs keep cases isolated from each other.
  t.after(async () => {
    try {
      if (webAuth.currentUser) await signOut(webAuth);
    } finally {
      try {
        await terminateClientFirestore(webDb);
        await deleteClientApp(webApp);
      } finally {
        await authAdmin.deleteUser(uid);
      }
    }
  });

  const credential = await signInWithEmailAndPassword(webAuth, email, password);
  assert.equal(credential.user.uid, uid);
  const token = await getIdTokenResult(credential.user, true);
  if (role) assert.equal(token.claims.role, role);
  return { uid, db: webDb, claims: token.claims };
}

async function expectDenied(operation) {
  await assert.rejects(operation, (error) => error.code === "permission-denied");
}

async function resetFixtures() {
  // DELETE /emulator/... exists only in the Firebase Firestore Emulator.
  // Clears all documents AND subcollections; tests cannot hit production.
  const response = await fetch(resetUrl, {
    method: "DELETE", signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error(`Firestore Emulator reset failed (${response.status}): ${await response.text()}`);
  }
}

async function makeAssignedSession(question, userId = "emulator-user-A") {
  const setup = {
    mode: question.mode,
    jobRole: question.jobRoles[0],
    experienceLevel: question.experienceLevels[0],
    tags: [question.tags[0]],
    questionCount: 1,
  };
  const session = await sessions.createSession({ userId, ...setup });
  const assigned = await sessions.assignQuestions({
    sessionId: session.id, userId, setup, questions: [question],
  });
  return { session, setup, assigned };
}

before(resetFixtures);
beforeEach(resetFixtures);
after(async () => {
  try {
    await resetFixtures();
  } finally {
    await terminateClientFirestore(clientDb);
    await deleteClientApp(clientApp);
    await db.terminate();
    await app.delete();
  }
});

test("H-E01: real batch upsert/read preserves question shape and updates catalog revision", async () => {
  assert.equal(await questions.upsertMany([quiz, theory, code]), 3);
  const stored = await questions.findById(quiz.id);
  assert.equal(stored.id, quiz.id);
  assert.equal(stored.prompt, quiz.prompt);
  assert.deepEqual(stored.options, quiz.options);
  assert.equal(stored.correctAnswer, quiz.correctAnswer);
  assert.equal(typeof stored._metadataSeedBatchId, "string");
  assert.ok(stored.updatedAt?.toDate?.() instanceof Date);
  assert.equal(await catalog.getRevision(), 1);
  assert.doesNotThrow(() => validateQuestion(stored));
  const storedTheory = await questions.findById(theory.id);
  assert.deepEqual(storedTheory.gradingCriteria, theory.gradingCriteria);
  assert.equal(storedTheory.referenceAnswer, theory.referenceAnswer);
  assert.doesNotThrow(() => validateQuestion(storedTheory));
});

test("H-E02: real Firestore mode query/projection feeds role, experience and tag filtering", async () => {
  const other = {
    ...structuredClone(theory),
    id: "integration-special-role",
    jobRoles: ["integration-special-role"],
    tags: ["integration-special-tag"],
  };
  await questions.upsertMany([quiz, theory, other, code]);
  const found = await questions.findByMode("Theoretical Style");
  assert.deepEqual(new Set(found.map((q) => q.id)), new Set([theory.id, other.id]));
  const projected = await questions.findByModeMetadata("Theoretical Style");
  assert.equal(projected.length, 2);
  assert.ok(projected.every((q) => Array.isArray(q.tags)));
  assert.ok(projected.every((q) => !("referenceAnswer" in q) && !("gradingCriteria" in q)));
  const chosen = selectQuestions(found, {
    jobRole: theory.jobRoles[0], experienceLevel: theory.experienceLevels[0],
    tags: [theory.tags[0]],
  }, 10);
  assert.deepEqual(chosen.map((q) => q.id), [theory.id]);
  assert.deepEqual(selectQuestions(found, {
    jobRole: "nobody", experienceLevel: "Beginner", tags: [theory.tags[0]],
  }), []);
  assert.deepEqual(await questions.findByMode("unsupported-mode"), []);
});

test("H-E05: missing records and malformed Firestore data are observable and validated", async () => {
  assert.equal(await questions.findById("missing-question"), null);
  assert.equal(await sessions.findById("missing-session"), null);
  assert.deepEqual(await sessions.listResponses("missing-session"), []);
  // Admin writes bypass the seed validator. Read the intentionally malformed
  // document to demonstrate why application boundaries must validate it.
  const ref = db.collection("questions").doc("malformed-integration-question");
  await ref.set({ mode: "Code Style", prompt: "Malformed", tags: "not-an-array", active: true });
  const invalid = await questions.findById(ref.id);
  assert.equal(invalid.id, ref.id);
  assert.throws(() => validateQuestion(invalid), /requires a nonblank difficulty/);
});

test("H-E03: session create/assign/read works with actual Firestore transactions", async () => {
  const { session, assigned } = await makeAssignedSession(theory);
  assert.equal(assigned.length, 1);
  assert.equal(assigned[0].id, theory.id);
  assert.equal("referenceAnswer" in assigned[0], false);
  assert.equal("gradingCriteria" in assigned[0], false);
  const saved = await sessions.findById(session.id);
  assert.equal(saved.userId, "emulator-user-A");
  assert.equal(saved.status, "active");
  assert.equal(saved.assignmentStatus, "assigned");
  assert.deepEqual(saved.assignedQuestionIds, [theory.id]);
  assert.equal(saved.assignedQuestions[0].id, theory.id);
  assert.ok(saved.createdAt?.toDate?.() instanceof Date);
  assert.deepEqual((await sessions.listByUser("emulator-user-A")).map((s) => s.id), [session.id]);
  assert.deepEqual(await sessions.listByUser("emulator-user-B"), []);
  const slot = await db.collection("users").doc("emulator-user-A")
    .collection("activeSessionSlots").doc(saved.activeSlotId).get();
  assert.equal(slot.data().sessionId, session.id);
});

test("H-E04: evaluation writes a real transaction and persists its full feedback", async () => {
  const { session } = await makeAssignedSession(theory);
  const feedback = {
    score: 87, feedback: "Strong explanation.", strengths: ["Correct concept"],
    weaknesses: ["Missing example"], suggestions: ["Provide an example"],
  };
  await evaluations.saveEvaluation({
    userId: "emulator-user-A", sessionId: session.id, questionId: theory.id,
    questionPrompt: theory.prompt, mode: theory.mode,
    candidateResponse: "A candidate explanation", evaluation: feedback,
  });
  const results = await sessions.listResponses(session.id);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, theory.id);
  assert.equal(results[0].questionId, theory.id);
  assert.equal(results[0].questionPrompt, theory.prompt);
  assert.equal(results[0].candidateResponse, "A candidate explanation");
  assert.deepEqual(results[0].evaluation, feedback);
  assert.ok(results[0].evaluatedAt?.toDate?.() instanceof Date);
  await assert.rejects(evaluations.saveEvaluation({
    userId: "emulator-user-A", sessionId: session.id, questionId: theory.id,
    mode: theory.mode, candidateResponse: "A duplicate evaluation", evaluation: feedback,
  }), (error) => error.statusCode === 409 && error.code === "QUESTION_ALREADY_ANSWERED");
  assert.equal((await sessions.listResponses(session.id)).length, 1);
});

test("H-E04: Quiz scoring persists a saved response and rejects duplicates", async () => {
  const { session } = await makeAssignedSession(quiz);
  const answer = await sessions.saveQuizAnswer({
    userId: "emulator-user-A", sessionId: session.id,
    question: quiz, answer: quiz.correctAnswer,
  });
  assert.equal(answer.isCorrect, true);
  const saved = await sessions.listResponses(session.id);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].candidateResponse, quiz.correctAnswer);
  assert.equal(saved[0].evaluation.score, 100);
  await assert.rejects(sessions.saveQuizAnswer({
    userId: "emulator-user-A", sessionId: session.id,
    question: quiz, answer: quiz.correctAnswer,
  }), (error) => error.statusCode === 409);
});

test("H-E05: invalid repository requests fail without creating documents", async () => {
  await assert.rejects(sessions.createSession({ userId: "", mode: "Quiz Style" }), /required/);
  await assert.rejects(evaluations.saveEvaluation({
    userId: "emulator-user-A", sessionId: "absent", questionId: theory.id,
    mode: theory.mode, candidateResponse: "an answer", evaluation: { score: 1 },
  }), (error) => error.statusCode === 404 && error.code === "SESSION_NOT_FOUND");
  assert.equal((await db.collection("sessions").get()).size, 0);
});

test("H-E06: clearing emulator fixtures removes subcollections and enables repeat runs", async () => {
  const { session } = await makeAssignedSession(quiz);
  await sessions.saveQuizAnswer({
    userId: "emulator-user-A", sessionId: session.id,
    question: quiz, answer: quiz.correctAnswer,
  });
  assert.equal((await sessions.listResponses(session.id)).length, 1);
  await resetFixtures();
  assert.equal(await sessions.findById(session.id), null);
  assert.equal((await db.collection("users").get()).size, 0);
  assert.equal((await db.collection("sessions").get()).size, 0);
  const recreated = await makeAssignedSession(quiz);
  assert.ok(recreated.session.id);
  assert.equal((await sessions.listByUser("emulator-user-A")).length, 1);
});

// H-03: Direct-client Firestore rules and server repository ownership integrity.
// Do not confuse these direct-client tests with Admin SDK authorization: Admin
// bypasses firestore.rules. Bryan owns HTTP/API session authorization tests.

test("H-SOC-01 (H-S01): anonymous Web SDK reads and collection queries are denied", async () => {
  const { session } = await makeAssignedSession(theory, "emulator-user-A");
  await questions.upsertMany([theory]);
  await db.collection("users").doc("testUserA").set({
    displayName: "Test User A", sensitiveMarker: "synthetic-private-marker",
  });
  // Prove that the documents exist through the Admin SDK before a client denial.
  assert.ok((await db.collection("users").doc("testUserA").get()).exists);
  assert.ok((await db.collection("sessions").doc(session.id).get()).exists);
  assert.ok((await db.collection("questions").doc(theory.id).get()).exists);

  for (const ref of [
    clientDoc(clientDb, "sessions", session.id),
    clientDoc(clientDb, "questions", theory.id),
    clientDoc(clientDb, "users", "testUserA"),
  ]) {
    await assert.rejects(getDoc(ref), (error) => error.code === "permission-denied");
  }
  await assert.rejects(getDocs(clientCollection(clientDb, "sessions")),
    (error) => error.code === "permission-denied");
  await assert.rejects(getDocs(clientCollection(clientDb, "questions")),
    (error) => error.code === "permission-denied");
  await expectDenied(getDocs(clientCollection(clientDb, "users")));
});

test("H-SOC-02 (H-S02): anonymous creates, updates and deletes preserve Admin data", async () => {
  const { session } = await makeAssignedSession(quiz, "emulator-user-A");
  const savedRef = db.collection("sessions").doc(session.id);
  const protectedUser = db.collection("users").doc("testUserA");
  await protectedUser.set({ displayName: "Test User A", testOnly: true });
  const beforeUser = (await protectedUser.get()).data();
  const before = (await savedRef.get()).data();
  const clientSession = clientDoc(clientDb, "sessions", session.id);
  const clientNew = clientDoc(clientDb, "sessions", "client-denied-create");

  await assert.rejects(setDoc(clientNew, { userId: "emulator-user-A" }),
    (error) => error.code === "permission-denied");
  await assert.rejects(updateDoc(clientSession, { userId: "attacker" }),
    (error) => error.code === "permission-denied");
  await assert.rejects(deleteDoc(clientSession),
    (error) => error.code === "permission-denied");
  await expectDenied(setDoc(clientDoc(clientDb, "users", "client-denied-create"), { admin: true }));
  await expectDenied(updateDoc(clientDoc(clientDb, "users", "testUserA"), { admin: true }));
  await expectDenied(deleteDoc(clientDoc(clientDb, "users", "testUserA")));

  assert.equal((await db.collection("sessions").doc("client-denied-create").get()).exists, false);
  assert.equal((await db.collection("users").doc("client-denied-create").get()).exists, false);
  assert.deepEqual((await savedRef.get()).data(), before);
  assert.deepEqual((await protectedUser.get()).data(), beforeUser);
});

// Task 3 security tests deliberately use the CLIENT SDK; Admin fixture success
// does not prove a Firestore security-rule decision.
test("H-SOC-03: signed-in users cannot directly read their own or another user's profile", async (t) => {
  const userA = await createAuthenticatedContext(t);
  const userB = await createAuthenticatedContext(t);
  const aRef = db.collection("users").doc(userA.uid);
  const bRef = db.collection("users").doc(userB.uid);
  await aRef.set({ ownerUid: userA.uid, syntheticSecret: "A-only" });
  await bRef.set({ ownerUid: userB.uid, syntheticSecret: "B-only" });
  const aBefore = (await aRef.get()).data();
  const bBefore = (await bRef.get()).data();

  await expectDenied(getDoc(clientDoc(userA.db, "users", userA.uid)));
  await expectDenied(getDoc(clientDoc(userA.db, "users", userB.uid)));
  await expectDenied(getDoc(clientDoc(userB.db, "users", userB.uid)));
  await expectDenied(getDoc(clientDoc(userB.db, "users", userA.uid)));

  assert.deepEqual((await aRef.get()).data(), aBefore);
  assert.deepEqual((await bRef.get()).data(), bBefore);
});

test("H-SOC-04: signed-in owner cannot directly update their own interview session", async (t) => {
  const owner = await createAuthenticatedContext(t);
  const { session } = await makeAssignedSession(quiz, owner.uid);
  const sessionRef = db.collection("sessions").doc(session.id);
  const before = (await sessionRef.get()).data();
  assert.equal(before.userId, owner.uid);

  await expectDenied(updateDoc(clientDoc(owner.db, "sessions", session.id), {
    userId: "attacker", status: "completed", rankEligible: true,
  }));
  assert.deepEqual((await sessionRef.get()).data(), before);
});

// SCRUM-251 / H-SOC-05: 4 collections x 2 real client auth states x
// 2 operation categories = 16 independently reported permission decisions.
// Fixtures use the Admin SDK ONLY for setup and verification; every access
// attempt below is made through the ordinary Firestore Web SDK.
test("H-SOC-05: 16-case sensitive-collection least-privilege matrix", async (t) => {
  const protectedDocs = [
    ["users", "testUserA"],
    ["sessions", "testSessionA"],
    ["questions", "testQuestionA"],
    ["serverConfig", "ai"],
  ];
  const synthetic = {
    classification: "synthetic-test-only",
    privateMarker: "synthetic-private-marker",
    owner: "testUserA",
    accessLevel: "backend-only",
  };
  // The global beforeEach(resetFixtures) hook also runs before nested t.test()
  // cases. Each matrix case must create its own Admin fixture *after* that reset.
  const signedIn = await createAuthenticatedContext(t);
  const contexts = [
    ["anonymous", clientDb],
    ["authenticated", signedIn.db],
  ];
  let checked = 0;
  for (const [authState, webDb] of contexts) {
    for (const [collectionName, documentId] of protectedDocs) {
      const path = `${collectionName}/${documentId}`;
      const adminRef = db.doc(path);
      const clientRef = clientDoc(webDb, collectionName, documentId);
      for (const operation of ["read", "write"]) {
        await t.test(`H-SOC-05 ${authState} ${operation} ${path}: DENIED`, async () => {
          // Seed this synthetic document after the inherited per-test reset.
          // The privileged Admin SDK write is NOT a client access grant.
          await adminRef.set(structuredClone(synthetic));
          const before = (await adminRef.get()).data();
          assert.deepEqual(before, synthetic, "Admin fixture must exist before the denial");
          if (operation === "read") {
            await expectDenied(getDoc(clientRef));
          } else {
            // An existing document makes setDoc an overwrite attempt, so both
            // the permission boundary and unchanged persisted data are checked.
            await expectDenied(setDoc(clientRef, {
              ...synthetic, privateMarker: "unapproved-client-modification",
            }));
          }
          assert.deepEqual((await adminRef.get()).data(), before,
            "Denied client operation must not change persisted data");
          checked += 1;
          console.log(`H-SOC-05 MATRIX ${authState} ${operation} ${path}: DENIED (expected)`);
        });
      }
    }
  }
  assert.equal(checked, 16, "All sixteen combinations must complete");
});

test("H-SOC-06: signed-in client with simulated admin claim cannot read or write", async (t) => {
  const pretendAdmin = await createAuthenticatedContext(t, { role: "admin" });
  const normalUser = await createAuthenticatedContext(t);
  assert.equal(pretendAdmin.claims.role, "admin");
  assert.equal(normalUser.claims.role, undefined);
  const profileRef = db.collection("users").doc(pretendAdmin.uid);
  await profileRef.set({ ownerUid: pretendAdmin.uid, access: "protected" });
  const { session } = await makeAssignedSession(quiz, pretendAdmin.uid);
  const sessionRef = db.collection("sessions").doc(session.id);
  const before = (await profileRef.get()).data();
  const beforeSession = (await sessionRef.get()).data();
  const clientProfile = clientDoc(pretendAdmin.db, "users", pretendAdmin.uid);
  const clientSession = clientDoc(pretendAdmin.db, "sessions", session.id);
  const clientNew = clientDoc(pretendAdmin.db, "users", "forged-admin-create");

  // Compare the simulated privileged token against a normal signed-in token.
  await expectDenied(getDoc(clientDoc(normalUser.db, "users", pretendAdmin.uid)));
  await expectDenied(getDoc(clientProfile));
  await expectDenied(getDoc(clientSession));
  await expectDenied(getDocs(clientCollection(pretendAdmin.db, "users")));
  await expectDenied(setDoc(clientDoc(normalUser.db, "users", "normal-denied-create"), { bypass: true }));
  await expectDenied(setDoc(clientNew, { role: "admin", bypass: true }));
  await expectDenied(updateDoc(clientProfile, { access: "compromised" }));
  await expectDenied(updateDoc(clientSession, { status: "completed" }));
  await expectDenied(deleteDoc(clientProfile));

  assert.equal((await db.collection("users").doc("normal-denied-create").get()).exists, false);
  assert.equal((await db.collection("users").doc("forged-admin-create").get()).exists, false);
  assert.deepEqual((await profileRef.get()).data(), before);
  assert.deepEqual((await sessionRef.get()).data(), beforeSession);
});

test("H-S03: separate users retain their immutable session owner after assignments and answers", async () => {
  const first = await makeAssignedSession(quiz, "emulator-user-A");
  const second = await makeAssignedSession(quiz, "emulator-user-B");
  const aBefore = await sessions.findById(first.session.id);
  const bBefore = await sessions.findById(second.session.id);

  await sessions.saveQuizAnswer({
    userId: "emulator-user-A", sessionId: first.session.id,
    question: quiz, answer: quiz.correctAnswer,
  });
  const aAfter = await sessions.findById(first.session.id);
  const bAfter = await sessions.findById(second.session.id);
  assert.equal(aAfter.userId, "emulator-user-A");
  assert.equal(bAfter.userId, "emulator-user-B");
  assert.deepEqual(aAfter.createdAt, aBefore.createdAt);
  assert.deepEqual(bAfter.createdAt, bBefore.createdAt);
  assert.deepEqual(aAfter.assignedQuestionIds, [quiz.id]);
  assert.deepEqual(bAfter.assignedQuestionIds, [quiz.id]);
  assert.equal((await sessions.listResponses(first.session.id)).length, 1);
  assert.deepEqual(await sessions.listResponses(second.session.id), []);
});

test("H-S04: user-specific history, completed history, and cursor reject another owner", async () => {
  const a = await makeAssignedSession(quiz, "emulator-user-A");
  const b = await makeAssignedSession(quiz, "emulator-user-B");
  // Admin directly marks completed records for a repository query fixture.
  // Do not invoke legacy completeSession(), which has a different scope.
  const completedAt = admin.firestore.Timestamp.now();
  await db.collection("sessions").doc(a.session.id).update({
    status: "completed", completedAt,
  });
  await db.collection("sessions").doc(b.session.id).update({
    status: "completed", completedAt,
  });

  for (const [userId, expectedId, otherId] of [
    ["emulator-user-A", a.session.id, b.session.id],
    ["emulator-user-B", b.session.id, a.session.id],
  ]) {
    assert.deepEqual((await sessions.listByUser(userId)).map((item) => item.id), [expectedId]);
    assert.deepEqual((await sessions.listCompletedByUser(userId)).map((item) => item.id), [expectedId]);
    const page = await sessions.getSessionPage({ userId, pageSize: 10, status: "completed" });
    assert.deepEqual(page.sessions.map((item) => item.id), [expectedId]);
    assert.equal(page.nextCursor, null);
    await assert.rejects(sessions.getSessionPage({ userId, pageSize: 10, cursor: otherId }),
      (error) => error.statusCode === 400 && error.code === "SESSION_CURSOR_INVALID");
  }
});

test("H-S05: missing owner fails closed and inconsistent active-slot owner is detected", async () => {
  const sessionRef = db.collection("sessions").doc("missing-owner-fixture");
  await sessionRef.set({ mode: "Quiz Style", status: "active", createdAt: admin.firestore.Timestamp.now() });
  const unowned = await sessions.findById(sessionRef.id);
  assert.equal(Object.hasOwn(unowned, "userId"), false);
  for (const userId of ["emulator-user-A", "emulator-user-B"]) {
    assert.throws(() => assertOwnedActiveSession(unowned, userId),
      (error) => error.code === "SESSION_FORBIDDEN" && error.statusCode === 403);
    assert.deepEqual((await sessions.listByUser(userId)).map((item) => item.id), []);
  }

  const created = await makeAssignedSession(quiz, "emulator-user-A");
  const originalId = created.session.id;
  // Simulate a corrupted database with a user A slot pointing to a session
  // whose owner field has been switched to user B by privileged code.
  await db.collection("sessions").doc(originalId).update({ userId: "emulator-user-B" });
  await db.collection("users").doc("emulator-user-A")
    .collection("activeSessionSlots").doc(created.session.activeSlotId)
    .update({ expiresAtMs: 0 });
  const limitedSessions = new SessionRepository({ db, admin, activeSessionLimit: 1 });
  await assert.rejects(limitedSessions.createSession({ userId: "emulator-user-A", mode: "Quiz Style" }),
    (error) => error.statusCode === 503 && /ownership is inconsistent/.test(error.message));
  assert.equal((await db.collection("sessions").get()).size, 2);
  assert.equal((await sessions.findById(originalId)).userId, "emulator-user-B");
});

test("H-S06: cross-user repository writes are denied without altering session or answers", async () => {
  const { session, setup } = await makeAssignedSession(quiz, "emulator-user-A");
  const ref = db.collection("sessions").doc(session.id);
  const before = (await ref.get()).data();

  await assert.rejects(sessions.assignQuestions({
    sessionId: session.id, userId: "emulator-user-B", setup, questions: [quiz],
  }), (error) => error.statusCode === 403 && error.code === "SESSION_FORBIDDEN");
  await assert.rejects(sessions.saveQuizAnswer({
    sessionId: session.id, userId: "emulator-user-B", question: quiz,
    answer: quiz.correctAnswer,
  }), (error) => error.statusCode === 403);
  await assert.rejects(evaluations.saveEvaluation({
    sessionId: session.id, userId: "emulator-user-B", questionId: quiz.id,
    mode: "Quiz Style", candidateResponse: "attack", evaluation: { score: 100 },
  }), (error) => error.statusCode === 403 && error.code === "SESSION_FORBIDDEN");
  assert.deepEqual((await ref.get()).data(), before);
  assert.deepEqual(await sessions.listResponses(session.id), []);
});
