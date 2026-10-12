const FirestoreSessionRepository = require("./FirestoreSessionRepository");

const TEST_USER_ID = "user-123";
const TEST_SESSION_ID = "session-123";

// 2. Shared test data factory
const createTestSession= (overrides = {}) => ({
  userId: TEST_USER_ID,
  mode: "technical",
  jobRole: "Software Engineer",
  experienceLevel: "entry",
  status: "in_progress",
  createdAt: "SERVER_TIMESTAMP",
  completedAt: null,
  ...overrides,
});



describe("FirestoreSessionRepository", () => {
let repository;
let mockDb;
let mockAdmin;
let mockSessions;
let mockDocRef;

beforeEach(() => {
mockDocRef = {
id: "session-123",
get: jest.fn(),
};

mockSessions = {
  add: jest.fn(),
  doc: jest.fn(),
};

mockDb = {
  collection: jest.fn().mockReturnValue(mockSessions),
};

mockAdmin = {
  firestore: {
    FieldValue: {
      serverTimestamp: jest.fn().mockReturnValue("SERVER_TIMESTAMP"),
    },
  },
};

repository = new FirestoreSessionRepository({
  db: mockDb,
  admin: mockAdmin,
});

});

test("creates a session with in_progress status", async () => {
const savedData = {
userId: "user-123",
mode: "technical",
jobRole: "Software Engineer",
experienceLevel: "entry",
status: "in_progress",
createdAt: "SERVER_TIMESTAMP",
completedAt: null,
};

mockSessions.add.mockResolvedValue(mockDocRef);
mockDocRef.get.mockResolvedValue({
  id: "session-123",
  data: () => savedData,
});

const session = await repository.createSession({
  userId: "user-123",
  mode: "technical",
  jobRole: "Software Engineer",
  experienceLevel: "entry",
});

expect(mockDb.collection).toHaveBeenCalledWith("sessions");
expect(mockSessions.add).toHaveBeenCalledWith(savedData);
expect(session).toEqual({
  id: "session-123",
  ...savedData,
});
expect(session.status).toBe("in_progress");


});


test("finds an existing session by ID", async () => {
const savedData = {
userId: "user-123",
mode: "technical",
jobRole: "Software Engineer",
experienceLevel: "entry",
status: "in_progress",
completedAt: null,
};

const mockDocument = {
id: "session-123",
exists: true,
data: () => savedData,
};

mockSessions.doc.mockReturnValue(mockDocRef);
mockDocRef.get.mockResolvedValue(mockDocument);

const session = await repository.findById(TEST_SESSION_ID);

expect(mockSessions.doc).toHaveBeenCalledWith(TEST_SESSION_ID);
expect(session).toEqual({
id: "session-123",
...savedData,
});
});


test("returns null when a session does not exist", async () => {
mockSessions.doc.mockReturnValue(mockDocRef);

mockDocRef.get.mockResolvedValue({
id: "missing-session",
exists: false,
});

const session = await repository.findById("missing-session");

expect(session).toBeNull();
});


test("lists sessions for a specific user", async () => {
const firstSession = createTestSession();

const secondSession = createTestSession({
mode: "behavioral",
status: "completed",
});

const mockQuery = {
orderBy: jest.fn().mockReturnThis(),
get: jest.fn().mockResolvedValue({
docs: [
{
id: "session-1",
data: () => firstSession,
},
{
id: "session-2",
data: () => secondSession,
},
],
}),
};

mockSessions.where = jest.fn().mockReturnValue(mockQuery);

const sessions = await repository.listByUser("user-123");

expect(mockSessions.where).toHaveBeenCalledWith(
"userId",
"==",
"user-123"
);

expect(mockQuery.orderBy).toHaveBeenCalledWith(
"createdAt",
"desc"
);

expect(sessions).toEqual([
{ id: "session-1", ...firstSession },
{ id: "session-2", ...secondSession },
]);
});

test("completes a session and updates its status", async () => {
const existingData = {
userId: "user-123",
mode: "technical",
jobRole: "Software Engineer",
experienceLevel: "entry",
status: "in_progress",
completedAt: null,
};

const completedData = {
...existingData,
status: "completed",
completedAt: "SERVER_TIMESTAMP",
};

mockSessions.doc.mockReturnValue(mockDocRef);

mockDocRef.get
.mockResolvedValueOnce({
exists: true,
data: () => existingData,
})
.mockResolvedValueOnce({
id: "session-123",
exists: true,
data: () => completedData,
});

mockDocRef.update = jest.fn().mockResolvedValue(undefined);

const session = await repository.completeSession("session-123");

expect(mockSessions.doc).toHaveBeenCalledWith("session-123");

expect(mockDocRef.update).toHaveBeenCalledWith({
status: "completed",
completedAt: "SERVER_TIMESTAMP",
});

expect(session).toEqual({
id: "session-123",
...completedData,
});
});


test("throws an error when completing a nonexistent session", async () => {
mockSessions.doc.mockReturnValue(mockDocRef);

mockDocRef.get.mockResolvedValue({
exists: false,
});

mockDocRef.update = jest.fn();

await expect(
repository.completeSession("missing-session")
).rejects.toThrow("Session not found.");

expect(mockDocRef.update).not.toHaveBeenCalled();
});



});
