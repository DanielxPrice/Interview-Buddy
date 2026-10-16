
const { createAccountDeletionService } = require("./accountDeletionService");

function setup() {
  const sessionQuery = {
    limit: jest.fn().mockReturnThis(),
    get: jest.fn()
      .mockResolvedValueOnce({ empty: false, docs: [{ ref: { path: "sessions/one" } }] })
      .mockResolvedValue({ empty: true, docs: [] }),
  };
  const profile = {
    listCollections: jest.fn().mockResolvedValue([
      { path: "users/u1/usage" },
      { path: "users/u1/questionReservations" },
    ]),
  };
  const sessions = { where: jest.fn(() => sessionQuery) };
  const users = { doc: jest.fn(() => profile) };
  const db = {
    collection: jest.fn((name) => (name === "sessions" ? sessions : users)),
    recursiveDelete: jest.fn().mockResolvedValue(),
  };
  const authClient = { deleteUser: jest.fn().mockResolvedValue() };
  const service = createAccountDeletionService({ db, authClient });
  return { service, db, authClient, sessions, profile };
}

test("deletes only owned sessions, subcollections, Auth, then profile", async () => {
  const { service, db, authClient, sessions, profile } = setup();
  await expect(service.deleteAccount("u1")).resolves.toEqual({
    deleted: true, deletedSessions: 1,
  });
  expect(sessions.where).toHaveBeenCalledWith("userId", "==", "u1");
  expect(db.recursiveDelete).toHaveBeenCalledTimes(4);
  expect(authClient.deleteUser).toHaveBeenCalledWith("u1");
  expect(db.recursiveDelete).toHaveBeenLastCalledWith(profile);
  expect(db.recursiveDelete.mock.invocationCallOrder[2]).toBeLessThan(
    authClient.deleteUser.mock.invocationCallOrder[0]
  );
});

test("does not delete Firebase Auth if Firestore cleanup fails", async () => {
  const { service, db, authClient } = setup();
  db.recursiveDelete.mockRejectedValueOnce(new Error("Firestore failed"));
  await expect(service.deleteAccount("u1")).rejects.toThrow("Firestore failed");
  expect(authClient.deleteUser).not.toHaveBeenCalled();
});

test("does not report success if Auth deletion fails", async () => {
  const { service, authClient } = setup();
  authClient.deleteUser.mockRejectedValueOnce(new Error("Auth failed"));
  await expect(service.deleteAccount("u1")).rejects.toThrow("Auth failed");
});

test("identifies a failure after Authentication was deleted", async () => {
  const { service, db } = setup();
  db.recursiveDelete.mockResolvedValueOnce()
    .mockResolvedValueOnce()
    .mockResolvedValueOnce()
    .mockRejectedValueOnce(new Error("Profile cleanup failed"));
  await expect(service.deleteAccount("u1")).rejects.toMatchObject({
    code: "account-deletion-partial",
  });
});

test("rejects empty authenticated identity", async () => {
  const { service, authClient } = setup();
  await expect(service.deleteAccount("")).rejects.toThrow("authenticated user ID");
  expect(authClient.deleteUser).not.toHaveBeenCalled();
});
