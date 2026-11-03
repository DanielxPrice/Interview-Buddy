"use strict";

// SCRUM-215 + SCRUM-190: real Firestore SDK integration, not mocked SDK calls.
// Run ONLY through Firebase emulators:exec using a demo project.
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
