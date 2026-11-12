
const { createAccountDeletionService } = require("./accountDeletionService");

function setup() {
  const sessionQuery = {
    limit: jest.fn().mockReturnThis(),
    get: jest.fn()
      .mockResolvedValueOnce({ empty: false, docs: [{ ref: { path: "sessions/one" } }] })
      .mockResolvedValue({ empty: true, docs: [] }),
  };
  const profile = {
    set: jest.fn().mockResolvedValue(),
    listCollections: jest.fn().mockResolvedValue([
      { path: "users/u1/usage" },
      { path: "users/u1/questionReservations" },
    ]),
  };
  const sessions = { where: jest.fn(() => sessionQuery) };
  const friendQuery = {
    limit: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
  };
  const friendships = { where: jest.fn(() => friendQuery) };
  const users = { doc: jest.fn(() => profile) };
  const db = {
    collection: jest.fn((name) => name === "sessions" ? sessions : name === "friendRelationships"
      ? friendships : name === "usernames"
        ? { where: () => ({ get: async () => ({ docs: [] }) }) } : users),
    recursiveDelete: jest.fn().mockResolvedValue(),
  };
  const authClient = { deleteUser: jest.fn().mockResolvedValue() };
  const service = createAccountDeletionService({ db, authClient });
  return { service, db, authClient, sessions, friendships, friendQuery, profile };
}

test("deletes only owned sessions, subcollections, Auth, then profile", async () => {
  const { service, db, authClient, sessions, friendships, profile } = setup();
  await expect(service.deleteAccount("u1")).resolves.toEqual({
    deleted: true, deletedSessions: 1,
  });
  expect(sessions.where).toHaveBeenCalledWith("userId", "==", "u1");
  expect(friendships.where).toHaveBeenCalledWith("participants", "array-contains", "u1");
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

test("continues cleanup when the Auth identity is already absent", async () => {
  const { service, authClient, db, profile } = setup();
  authClient.deleteUser.mockRejectedValueOnce({ code: "auth/user-not-found" });
  await expect(service.deleteAccount("u1")).resolves.toMatchObject({ deleted: true });
  expect(db.recursiveDelete).toHaveBeenLastCalledWith(profile);
});

test("marks the profile before removing owned data", async () => {
  const { service, profile, db } = setup();
  await service.deleteAccount("u1");
  expect(profile.set).toHaveBeenCalledWith(
    { deleting: true, status: "deleting" }, { merge: true }
  );
  expect(profile.set.mock.invocationCallOrder[0]).toBeLessThan(
    db.recursiveDelete.mock.invocationCallOrder[0]
  );
});


test("deletes all pending, accepted and declined friend relationships before Auth deletion", async () => {
  const { service, db, authClient, friendQuery } = setup();
  const refs = [
    { path: "friendRelationships/pending" },
    { path: "friendRelationships/accepted" },
    { path: "friendRelationships/declined" },
  ];
  friendQuery.get.mockReset()
    .mockResolvedValueOnce({ empty: false, docs: refs.map((ref) => ({ ref })) })
    .mockResolvedValue({ empty: true, docs: [] });

  await expect(service.deleteAccount("u1")).resolves.toMatchObject({ deleted: true });
  for (const ref of refs) expect(db.recursiveDelete).toHaveBeenCalledWith(ref);
  expect(friendQuery.limit).toHaveBeenCalledWith(50);
  const lastDelete = Math.max(...refs.map((ref) =>
    db.recursiveDelete.mock.invocationCallOrder[db.recursiveDelete.mock.calls.findIndex(([arg]) => arg === ref)]));
  expect(lastDelete).toBeLessThan(authClient.deleteUser.mock.invocationCallOrder[0]);
});

test("failed relationship cleanup retains Auth identity and profile deletion marker for retry", async () => {
  const { service, db, authClient, friendQuery, profile } = setup();
  const relation = { path: "friendRelationships/a-b" };
  friendQuery.get.mockReset().mockResolvedValueOnce({ empty: false, docs: [{ ref: relation }] });
  db.recursiveDelete.mockImplementation(async (ref) => {
    if (ref === relation) throw new Error("Relationship cleanup unavailable");
  });
  await expect(service.deleteAccount("u1")).rejects.toThrow("Relationship cleanup unavailable");
  expect(authClient.deleteUser).not.toHaveBeenCalled();
  expect(profile.set).toHaveBeenCalledWith(
    { deleting: true, status: "deleting" }, { merge: true }
  );
});
