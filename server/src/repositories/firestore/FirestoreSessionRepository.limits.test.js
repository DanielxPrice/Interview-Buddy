"use strict";

const FirestoreSessionRepository = require("./FirestoreSessionRepository");

function fixture({ limit = 2, time = "2026-10-28T19:00:00.000Z" } = {}) {
  const docs = new Map();
  let clock = new Date(time);
  let nextId = 1;

  function ref(path) {
    return {
      id: path.split("/").pop(), path,
      collection: (name) => ({ doc: (id) => ref(`${path}/${name}/${id}`) }),
      get: async () => ({ id: path.split("/").pop(), exists: docs.has(path), data: () => docs.get(path) }),
    };
  }

  function query(conditions = [], order = null, after = null, maximum = Infinity) {
    return {
      where: (field, op, value) => query([...conditions, [field, op, value]], order, after, maximum),
      orderBy: (field, direction) => query(conditions, [field, direction], after, maximum),
      startAfter: (snapshot) => query(conditions, order, snapshot.id, maximum),
      limit: (count) => query(conditions, order, after, count),
      get: async () => {
        let rows = Array.from(docs.entries())
          .filter(([path]) => /^sessions\/[^/]+$/.test(path))
          .map(([path, data]) => ({ id: path.split("/")[1], data: () => data }));
        for (const [field, , value] of conditions) {
          rows = rows.filter((row) => row.data()[field] === value);
        }
        if (order) rows.sort((a, b) => String(b.data()[order[0]]).localeCompare(String(a.data()[order[0]])));
        if (after) {
          const idx = rows.findIndex((row) => row.id === after);
          rows = idx < 0 ? [] : rows.slice(idx + 1);
        }
        return { docs: rows.slice(0, maximum) };
      },
    };
  }

  const db = {
    collection: (name) => name === "sessions" ? {
      doc: (id) => ref(`sessions/${id || `auto-${nextId++}`}`),
      ...query(),
    } : { doc: (id) => ref(`${name}/${id}`) },
    runTransaction: async (callback) => {
      const writes = [];
      const tx = {
        get: async (r) => r.get(),
        set: (r, value) => writes.push(["set", r.path, value]),
        create: (r, value) => writes.push(["create", r.path, value]),
      };
      const result = await callback(tx);
      for (const [operation, path, value] of writes) {
        if (operation === "create" && docs.has(path)) throw new Error("Already exists");
        docs.set(path, value);
      }
      return result;
    },
  };
  const repository = new FirestoreSessionRepository({
    db, dailySessionLimit: limit, timeZone: "America/Los_Angeles", now: () => clock,
  });
  return {
    repository, docs, setTime: (timeString) => { clock = new Date(timeString); },
    create: (userId = "user-A") => repository.createSession({ userId, mode: "Quiz Style" }),
  };
}

describe("SEC-05 bounded session creation and history", () => {
  test("allows limit requests across sessions and rejects limit+1 atomically", async () => {
    const f = fixture();
    expect((await f.create()).id).toBe("auto-1");
    expect((await f.create()).id).toBe("auto-2");
    await expect(f.create()).rejects.toMatchObject({
      statusCode: 429, code: "DAILY_SESSION_LIMIT_EXCEEDED",
    });
    expect([...f.docs.keys()].filter((path) => /^sessions\//.test(path))).toHaveLength(2);
    expect(f.docs.get("users/user-A/sessionCreationUsage/2026-10-28").created).toBe(2);
  });

  test("different users get independent session creation limits", async () => {
    const f = fixture({ limit: 1 });
    await f.create("user-A");
    await f.create("user-B");
    await expect(f.create("user-A")).rejects.toMatchObject({ statusCode: 429 });
    expect(f.docs.get("users/user-B/sessionCreationUsage/2026-10-28").created).toBe(1);
  });

  test("session creation budget resets at Los Angeles midnight", async () => {
    const f = fixture({ limit: 1, time: "2026-10-28T06:59:00.000Z" });
    await f.create();
    f.setTime("2026-10-28T07:01:00.000Z");
    await f.create();
    expect(f.docs.get("users/user-A/sessionCreationUsage/2026-10-27").created).toBe(1);
    expect(f.docs.get("users/user-A/sessionCreationUsage/2026-10-28").created).toBe(1);
  });

  test("invalid usage state rejects creation before any session is written", async () => {
    const f = fixture();
    f.docs.set("users/user-A/sessionCreationUsage/2026-10-28", { created: -1 });
    await expect(f.create()).rejects.toMatchObject({ statusCode: 503 });
    expect([...f.docs.keys()].filter((path) => /^sessions\//.test(path))).toHaveLength(0);
  });

  test("completed history returns a bounded first page and an older-page cursor", async () => {
    const f = fixture();
    for (let n = 1; n <= 5; n++) {
      f.docs.set(`sessions/s${n}`, {
        userId: "user-A", status: "completed",
        completedAt: `2026-10-${String(n).padStart(2, "0")}T18:00:00Z`,
      });
    }
    f.docs.set("sessions/foreign", { userId: "user-B", status: "completed", completedAt: "2026-11-01T18:00:00Z" });
    const first = await f.repository.getSessionPage({ userId: "user-A", status: "completed", pageSize: 2 });
    expect(first.sessions.map((s) => s.id)).toEqual(["s5", "s4"]);
    expect(first.nextCursor).toBe("s4");
    const second = await f.repository.getSessionPage({ userId: "user-A", status: "completed", pageSize: 2, cursor: first.nextCursor });
    expect(second.sessions.map((s) => s.id)).toEqual(["s3", "s2"]);
    expect(second.nextCursor).toBe("s2");
    const third = await f.repository.getSessionPage({ userId: "user-A", status: "completed", pageSize: 2, cursor: second.nextCursor });
    expect(third.sessions.map((s) => s.id)).toEqual(["s1"]);
    expect(third.nextCursor).toBeNull();
  });

  test("rejects another user's cursor before querying older history", async () => {
    const f = fixture();
    f.docs.set("sessions/foreign", { userId: "user-B", status: "completed" });
    await expect(f.repository.getSessionPage({ userId: "user-A", status: "completed", pageSize: 2, cursor: "foreign" }))
      .rejects.toMatchObject({ statusCode: 400, code: "SESSION_CURSOR_INVALID" });
  });

  test("validates page boundaries and cannot run an unbounded query", async () => {
    const f = fixture();
    for (const pageSize of [0, 51, Infinity, 1.5]) {
      await expect(f.repository.getSessionPage({ userId: "user-A", pageSize }))
        .rejects.toMatchObject({ code: "SESSION_PAGE_SIZE_INVALID" });
    }
    expect(() => new FirestoreSessionRepository({ db: f.repository.db, dailySessionLimit: 0 }))
      .toThrow(/positive integer/);
  });
});
