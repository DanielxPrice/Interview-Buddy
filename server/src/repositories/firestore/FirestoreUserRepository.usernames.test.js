const FirestoreUserRepository = require("./FirestoreUserRepository");

function setup(initial = {}) {
  const data = new Map(Object.entries(initial));
  const ref = (path) => ({ path });
  const snapshot = (reference) => ({
    exists: data.has(reference.path), id: reference.path.split("/").pop(),
    data: () => data.get(reference.path),
  });
  const db = {
    collection: (name) => ({
      doc: (id) => ({ ...ref(`${name}/${id}`), get: async () => snapshot(ref(`${name}/${id}`)) }),
      where: (_field, _op, value) => ({ limit: () => ({ get: async () => {
        const docs = [...data].filter(([path, valueData]) => path.startsWith("users/") && valueData.usernameLower === value)
          .map(([path]) => snapshot(ref(path)));
        return { empty: !docs.length, docs };
      } }) }),
    }),
    runTransaction: async (callback) => {
      const writes = [];
      const result = await callback({
        get: async (reference) => snapshot(reference),
        set: (reference, value) => writes.push(() => data.set(reference.path, value)),
        create: (reference, value) => writes.push(() => data.set(reference.path, value)),
        update: (reference, value) => writes.push(() => data.set(reference.path, { ...data.get(reference.path), ...value })),
        delete: (reference) => writes.push(() => data.delete(reference.path)),
      });
      writes.forEach((write) => write());
      return result;
    },
  };
  return { repository: new FirestoreUserRepository({ db }), data };
}

test("a username reservation rejects another owner even without a profile", async () => {
  const { repository, data } = setup();
  const claim = repository.usernameRef("Name");
  data.set(claim.path, { uid: "other" });
  await expect(repository.createProfile({ uid: "u1", username: "NAME", email: "u@example.com" }))
    .rejects.toMatchObject({ code: "username-already-exists" });
  expect(data.has("users/u1")).toBe(false);
});

test("rename transfers reservation and a released username can be reused", async () => {
  const { repository, data } = setup();
  await repository.createProfile({ uid: "u1", username: "Old", email: "u@example.com" });
  await repository.updateProfile("u1", { username: "New" });
  expect(data.has(repository.usernameRef("Old").path)).toBe(false);
  expect(data.get(repository.usernameRef("New").path)).toEqual({ uid: "u1" });
  await repository.createProfile({ uid: "u2", username: "old", email: "v@example.com" });
  expect(data.get("users/u2").username).toBe("old");
});

test("legacy username lookup uses the document ID when uid is absent", async () => {
  const { repository } = setup({ "users/u1": { username: "Name", usernameLower: "name" } });
  await expect(repository.updateProfile("u1", { username: "NAME" })).resolves.toMatchObject({ username: "NAME" });
});
