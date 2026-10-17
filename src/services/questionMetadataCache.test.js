jest.mock("../config/firebase", () => ({
  auth: { currentUser: { getIdToken: jest.fn().mockResolvedValue("test-token") } },
}));

const MODE = "Code Style";

beforeEach(() => {
  jest.resetModules();
  global.fetch = jest.fn();
});

test("renders bundled metadata on first visit without fetch", () => {
  const cache = require("./questionMetadataCache");
  const options = cache.getCachedSetupOptions(MODE, {
    jobRole: "software engineer", experienceLevel: "Beginner",
  });
  expect(options.jobRoles).toContain("software engineer");
  expect(options.tags.length).toBeGreaterThan(0);
  expect(global.fetch).not.toHaveBeenCalled();
});

test("a new Firestore revision updates listeners without requiring a page reload", async () => {
  const cache = require("./questionMetadataCache");
  const changed = jest.fn();
  const unsubscribe = cache.subscribeSetupMetadata(changed);
  const old = cache.getCachedSetupOptions(MODE);
  const snapshot = require("../data/questionMetadata.json");
  const newSnapshot = JSON.parse(JSON.stringify(snapshot));
  newSnapshot.modes[MODE].all.tags = ["newly added", ...old.tags];
  global.fetch
    .mockResolvedValueOnce({ ok: true, json: async () => ({ version: 15 }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ version: 15, ...newSnapshot }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ version: 15 }) });

  expect(await cache.refreshSetupMetadata()).toBe(true);
  expect(changed).toHaveBeenCalledTimes(1);
  expect(cache.getCachedSetupOptions(MODE).tags[0]).toBe("newly added");
  expect(await cache.refreshSetupMetadata()).toBe(false);
  expect(global.fetch).toHaveBeenCalledTimes(3);
  unsubscribe();
});

test("failed network refresh preserves bundled metadata", async () => {
  const cache = require("./questionMetadataCache");
  const before = cache.getCachedSetupOptions(MODE);
  global.fetch.mockRejectedValueOnce(new Error("offline"));
  await expect(cache.refreshSetupMetadata()).rejects.toThrow("offline");
  expect(cache.getCachedSetupOptions(MODE)).toEqual(before);
});
