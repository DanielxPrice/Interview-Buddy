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

test("counts locally from bundled index, including overlapping tags only once", () => {
  const cache = require("./questionMetadataCache");
  const snapshot = require("../data/questionMetadata.json");
  expect(snapshot.schemaVersion).toBe(2);
  const setup = {
    mode: MODE,
    jobRole: "SOFTWARE ENGINEER",
    experienceLevel: "beginner",
  };
  const index = snapshot.modes[MODE].countIndex;
  const expected = index.filter((group) =>
    group.jobRoles.includes("software engineer") &&
    group.experienceLevels.includes("beginner") &&
    group.tags.some((tag) => ["algorithms", "data structures"].includes(tag))
  ).reduce((sum, group) => sum + group.count, 0);

  expect(cache.getCachedAvailableQuestionCount({
    ...setup, tags: ["Algorithms", "DATA STRUCTURES", "algorithms"],
  })).toBe(expected);
  expect(cache.getCachedAvailableQuestionCount({ ...setup, tags: ["missing-tag"] })).toBe(0);
  expect(cache.getCachedAvailableQuestionCount({ ...setup, tags: [] })).toBeNull();
  expect(global.fetch).not.toHaveBeenCalled();
});

test("metadata refresh changes the cached question count and notifies subscribers", async () => {
  const cache = require("./questionMetadataCache");
  const listener = jest.fn();
  const unsubscribe = cache.subscribeSetupMetadata(listener);
  const updated = JSON.parse(JSON.stringify(require("../data/questionMetadata.json")));
  const query = { mode: MODE, jobRole: "software engineer", experienceLevel: "Beginner", tags: ["custom-tag"] };
  expect(cache.getCachedAvailableQuestionCount(query)).toBe(0);
  updated.modes[MODE].countIndex.push({
    jobRoles: ["software engineer"], experienceLevels: ["beginner"],
    tags: ["custom-tag"], count: 3,
  });
  global.fetch
    .mockResolvedValueOnce({ ok: true, json: async () => ({ version: 20 }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ ...updated, version: 20 }) });
  await cache.refreshSetupMetadata();
  expect(cache.getCachedAvailableQuestionCount(query)).toBe(3);
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
});

test("a schema 1 backend response falls back to server counts", async () => {
  const cache = require("./questionMetadataCache");
  const old = JSON.parse(JSON.stringify(require("../data/questionMetadata.json")));
  old.schemaVersion = 1;
  for (const mode of Object.values(old.modes)) delete mode.countIndex;
  global.fetch
    .mockResolvedValueOnce({ ok: true, json: async () => ({ version: 21 }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ ...old, version: 21 }) });
  expect(await cache.refreshSetupMetadata()).toBe(true);
  expect(cache.getCachedAvailableQuestionCount({
    mode: MODE, jobRole: "software engineer", experienceLevel: "Beginner", tags: ["tree"],
  })).toBeNull();
});
