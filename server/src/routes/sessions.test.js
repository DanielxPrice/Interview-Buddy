const request = require("supertest");
const express = require("express");
const createSessionRouter = require("./sessions");

describe("Session API endpoints", () => {
let app;
let sessionRepository;

const testUserId = "test-user-123";

const testSession = {
id: "session-123",
userId: testUserId,
mode: "technical",
jobRole: "Software Engineer",
experienceLevel: "entry",
status: "in_progress",
completedAt: null,
};

beforeEach(() => {
sessionRepository = {
createSession: jest.fn(),
findById: jest.fn(),
listByUser: jest.fn(),
completeSession: jest.fn(),
};


app = express();
app.use(express.json());

// Test-only authentication middleware.
// Production authentication remains in your actual app.
app.use((req, res, next) => {
  req.user = { uid: testUserId };
  next();
});

app.use("/api/sessions", createSessionRouter({ sessionRepository }));

app.use((error, req, res, next) => {
  res.status(500).json({ error: error.message });
});


});

test("creates a session", async () => {
sessionRepository.createSession.mockResolvedValue(testSession);


const response = await request(app)
  .post("/api/sessions")
  .send({
    mode: "technical",
    jobRole: "Software Engineer",
    experienceLevel: "entry",
  });

expect(response.status).toBe(201);
expect(response.body.session.id).toBe("session-123");
expect(sessionRepository.createSession).toHaveBeenCalledWith({
  userId: testUserId,
  mode: "technical",
  jobRole: "Software Engineer",
  experienceLevel: "entry",
});


});

test("lists sessions for the authenticated user", async () => {
sessionRepository.listByUser.mockResolvedValue([testSession]);


const response = await request(app).get("/api/sessions");

expect(response.status).toBe(200);
expect(response.body.sessions).toHaveLength(1);
expect(sessionRepository.listByUser).toHaveBeenCalledWith(testUserId);


});

test("retrieves an existing session", async () => {
sessionRepository.findById.mockResolvedValue(testSession);


const response = await request(app).get("/api/sessions/session-123");

expect(response.status).toBe(200);
expect(response.body.session.id).toBe("session-123");


});

test("returns 404 when a session does not exist", async () => {
sessionRepository.findById.mockResolvedValue(null);


const response = await request(app).get("/api/sessions/missing-session");

expect(response.status).toBe(404);


});

test("completes a session owned by the authenticated user", async () => {
sessionRepository.findById.mockResolvedValue(testSession);
sessionRepository.completeSession.mockResolvedValue({
...testSession,
status: "completed",
completedAt: "2026-10-11T00:00:00.000Z",
});


const response = await request(app)
  .patch("/api/sessions/session-123/complete");

expect(response.status).toBe(200);
expect(response.body.session.status).toBe("completed");
expect(sessionRepository.completeSession).toHaveBeenCalledWith(
  "session-123"
);


});

test("does not allow access to another user's session", async () => {
sessionRepository.findById.mockResolvedValue({
...testSession,
userId: "another-user-456",
});


const response = await request(app).get("/api/sessions/session-123");

expect(response.status).toBe(404);
expect(sessionRepository.completeSession).not.toHaveBeenCalled();


});
});
