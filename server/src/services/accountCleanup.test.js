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
  const db = {
    collection: (name) => name === "sessions" ? sessions : name === "usernames" ? claims : { doc: () => profile },
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
  expect(db.recursiveDelete).toHaveBeenCalledWith(session);
  expect(db.recursiveDelete).toHaveBeenLastCalledWith(profile);
  expect(removeClaim).toHaveBeenCalled();
});

test("cleanup errors propagate to trigger retries", async () => {
  const db = { collection: () => ({ where: () => ({ limit: () => ({ get: async () => { throw new Error("offline"); } }) }) }) };
  await expect(cleanupDeletedAccount(db, "u1")).rejects.toThrow("offline");
});
