
"use strict";

const firebaseConfig = require("../../../../firebase.json");
const indexConfig = require("../../../../firestore.indexes.json");
const FirestoreSessionRepository = require("./FirestoreSessionRepository");
const {
  SESSION_HISTORY_PAGE_MAX,
} = require("../../config/sessionStorageLimits");

function makeFixture({ cursorData = null, queryDocs = [] } = {}) {
  const filters = [];
  const orders = [];

  const cursorGet = jest.fn().mockResolvedValue(
    cursorData === null
      ? { exists: false }
      : {
          exists: true,
          id: "cursor-1",
          data: () => cursorData,
        }
  );

  const query = {
    where: jest.fn((field, op, value) => {
      filters.push({ field, op, value });
      return query;
    }),

    orderBy: jest.fn((field, direction) => {
      orders.push({ field, direction });
      return query;
    }),

    startAfter: jest.fn(() => query),
    limit: jest.fn(() => query),
    get: jest.fn().mockResolvedValue({ docs: queryDocs }),
  };

  const sessions = {
    ...query,
    doc: jest.fn(() => ({ get: cursorGet })),
  };

  const db = {
    collection: jest.fn(() => sessions),
  };

  return {
    repository: new FirestoreSessionRepository({ db }),
    filters,
    orders,
    query,
    sessions,
    cursorGet,
  };
}

function requiredIndexFields(fixture) {
  const equalityFields = fixture.filters.map(({ field, op }) => {
    expect(op).toBe("==");

    return {
      fieldPath: field,
      order: "ASCENDING",
    };
  });

  const sortingFields = fixture.orders.map(
    ({ field, direction }) => ({
      fieldPath: field,
      order: direction === "desc" ? "DESCENDING" : "ASCENDING",
    })
  );

  return [...equalityFields, ...sortingFields];
}

function expectDeclaredSessionIndex(fixture) {
  const needed = requiredIndexFields(fixture);

  expect(indexConfig.indexes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        collectionGroup: "sessions",
        queryScope: "COLLECTION",
        fields: needed,
      }),
    ])
  );
}

describe("SCRUM-86 Firestore index configuration and query integrity", () => {
  test("Firebase deploy configuration points to the versioned indexes file", () => {
    expect(firebaseConfig.firestore.indexes)
      .toBe("firestore.indexes.json");

    expect(firebaseConfig.firestore.rules)
      .toBe("firestore.rules");
  });

  test("declared composite indexes have distinct valid field signatures", () => {
    const signatures = indexConfig.indexes.map((index) => {
      expect(index.queryScope).toBe("COLLECTION");
      expect(index.fields.length).toBeGreaterThan(1);

      for (const field of index.fields) {
        expect(typeof field.fieldPath).toBe("string");
        expect(["ASCENDING", "DESCENDING"])
          .toContain(field.order);
      }

      return JSON.stringify([
        index.collectionGroup,
        index.queryScope,
        index.fields,
      ]);
    });

    expect(new Set(signatures).size).toBe(signatures.length);
  });

  test("ordinary history query is backed by the userId/createdAt index", async () => {
    const f = makeFixture();

    await f.repository.listByUser("user-A");

    expect(f.filters).toEqual([
      {
        field: "userId",
        op: "==",
        value: "user-A",
      },
    ]);

    expect(f.orders).toEqual([
      {
        field: "createdAt",
        direction: "desc",
      },
    ]);

    expect(f.query.limit)
      .toHaveBeenCalledWith(SESSION_HISTORY_PAGE_MAX);

    expectDeclaredSessionIndex(f);
  });

  test("completed history query is backed by userId/status/completedAt index", async () => {
    const f = makeFixture();

    await f.repository.listCompletedByUser("user-A");

    expect(f.filters).toEqual([
      {
        field: "userId",
        op: "==",
        value: "user-A",
      },
      {
        field: "status",
        op: "==",
        value: "completed",
      },
    ]);

    expect(f.orders).toEqual([
      {
        field: "completedAt",
        direction: "desc",
      },
    ]);

    expect(f.query.limit)
      .toHaveBeenCalledWith(SESSION_HISTORY_PAGE_MAX);

    expectDeclaredSessionIndex(f);
  });

  test.each([
    [null, "createdAt", 4],
    ["completed", "completedAt", 4],
  ])(
    "paginated %s history uses the corresponding composite index",
    async (status, field, limit) => {
      const f = makeFixture();

      await f.repository.getSessionPage({
        userId: "user-A",
        status,
        pageSize: 3,
      });

      expect(f.orders).toEqual([
        {
          field,
          direction: "desc",
        },
      ]);

      expect(f.query.limit)
        .toHaveBeenCalledWith(limit);

      expectDeclaredSessionIndex(f);
    }
  );

  test("rejects a same-owner cursor whose status mismatches completed history", async () => {
    const f = makeFixture({
      cursorData: {
        userId: "user-A",
        status: "active",
      },
    });

    await expect(
      f.repository.getSessionPage({
        userId: "user-A",
        status: "completed",
        pageSize: 5,
        cursor: "cursor-1",
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "SESSION_CURSOR_INVALID",
    });

    expect(f.query.get).not.toHaveBeenCalled();
  });

  test("rejects a deleted history cursor rather than returning a misleading page", async () => {
    const f = makeFixture();

    await expect(
      f.repository.getSessionPage({
        userId: "user-A",
        pageSize: 5,
        cursor: "deleted-session",
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "SESSION_CURSOR_INVALID",
    });

    expect(f.query.get).not.toHaveBeenCalled();
  });

  test("propagates a Firestore paging failure instead of reporting empty history", async () => {
    const f = makeFixture();

    f.query.get.mockRejectedValue(
      new Error("Firestore index/query unavailable")
    );

    await expect(
      f.repository.getSessionPage({
        userId: "user-A",
        pageSize: 5,
      })
    ).rejects.toThrow(
      "Firestore index/query unavailable"
    );
  });
});
