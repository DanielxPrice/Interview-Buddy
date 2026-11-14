const { cleanupDeletedAccount } = require("../../../functions/accountCleanup");

test("Auth deletion cleanup removes sessions, claims, and all profile descendants", async () => {
  const session = { path: "sessions/s1" };
  const profile = { path: "users/u1" };
  const removeClaim = jest.fn().mockResolvedValue();
  const getSessions = jest.fn()
    .mockResolvedValueOnce({ empty: false, docs: [{ ref: session }] })
    .mockResolvedValue({ empty: true, docs: [] });
  const sessions = { where: jest.fn(() => ({ limit: () => ({ get: getSessions }) })) };
  const claims = { where: jest.fn(() => ({ get: async () => ({ docs: [{ ref: { delete: removeClaim } }] }) })) };
  const friendQuery = { get: jest.fn().mockResolvedValueOnce({
    empty: false, docs: [{ ref: { path: "friendRelationships/one" } }],
  }).mockResolvedValue({ empty: true, docs: [] }) };
  const friendships = { where: jest.fn(() => ({ limit: () => friendQuery })) };
  const db = {
    collection: (name) => name === "sessions" ? sessions : name === "usernames" ? claims
      : name === "friendRelationships" ? friendships : { doc: () => profile },
    recursiveDelete: jest.fn().mockResolvedValue(),
    runTransaction: (callback) => callback({
      get: async () => ({ exists: true, data: () => ({ uid: "u1" }) }),
      delete: () => removeClaim(),
    }),
  };
  await cleanupDeletedAccount(db, "u1");
  await cleanupDeletedAccount(db, "u1");
  expect(sessions.where).toHaveBeenCalledWith("userId", "==", "u1");
  expect(claims.where).toHaveBeenCalledWith("uid", "==", "u1");
  expect(friendships.where).toHaveBeenCalledWith("participants", "array-contains", "u1");
  expect(db.recursiveDelete).toHaveBeenCalledWith({ path: "friendRelationships/one" });
  expect(db.recursiveDelete).toHaveBeenCalledWith(session);
  expect(db.recursiveDelete).toHaveBeenLastCalledWith(profile);
  expect(removeClaim).toHaveBeenCalled();
});

test("cleanup errors propagate to trigger retries", async () => {
  const db = { collection: () => ({ where: () => ({ limit: () => ({ get: async () => { throw new Error("offline"); } }) }) }) };
  await expect(cleanupDeletedAccount(db, "u1")).rejects.toThrow("offline");
});


test("Auth deletion cleanup propagates relationship failures for retries", async () => {
  const db = {
    collection: (name) => name === "sessions" ? {
      where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }),
    } : {
      where: () => ({ limit: () => ({ get: async () => { throw new Error("friend cleanup offline"); } }) }),
    },
  };
  await expect(cleanupDeletedAccount(db, "u1")).rejects.toThrow("friend cleanup offline");
});
