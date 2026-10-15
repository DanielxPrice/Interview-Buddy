const {
  backfillUserRoles,
} = require("./userRoleMigration");

jest.mock("../config/roles", () => ({
  DEFAULT_USER_ROLE: "user",
  VALID_USER_ROLES: new Set([
    "user",
    "admin",
  ]),
}));

describe("backfillUserRoles", () => {
  let admin;

  beforeEach(() => {
    admin = {
      firestore: {
        FieldValue: {
          serverTimestamp: jest.fn(
            () => "mock-server-timestamp"
          ),
        },
      },
    };
  });

  function createDb(documents) {
    return {
      collection: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({
          docs: documents,
        }),
      })),
    };
  }

  function createDocument(id, data) {
    return {
      id,
      data: () => data,
      ref: {
        set: jest.fn().mockResolvedValue(),
      },
    };
  }

  test("adds the default role when a user has no role", async () => {
    const document = createDocument(
      "user-1",
      {
        username: "OldUser",
      }
    );

    const db = createDb([document]);

    const result =
      await backfillUserRoles({
        db,
        admin,
      });

    expect(
      document.ref.set
    ).toHaveBeenCalledWith(
      {
        role: "user",
        updatedAt:
          "mock-server-timestamp",
      },
      {
        merge: true,
      }
    );

    expect(result).toEqual({
      usersScanned: 1,
      missingRoles: 1,
      invalidRoles: 0,
      validRolesPreserved: 0,
      rolesWritten: 1,
      errors: 0,
    });
  });

  test("preserves existing user and admin roles", async () => {
    const userDocument =
      createDocument(
        "user-1",
        {
          role: "user",
        }
      );

    const adminDocument =
      createDocument(
        "admin-1",
        {
          role: "admin",
        }
      );

    const db = createDb([
      userDocument,
      adminDocument,
    ]);

    const result =
      await backfillUserRoles({
        db,
        admin,
      });

    expect(
      userDocument.ref.set
    ).not.toHaveBeenCalled();

    expect(
      adminDocument.ref.set
    ).not.toHaveBeenCalled();

    expect(result).toEqual({
      usersScanned: 2,
      missingRoles: 0,
      invalidRoles: 0,
      validRolesPreserved: 2,
      rolesWritten: 0,
      errors: 0,
    });
  });

  test("resets an invalid stored role to user", async () => {
    const document = createDocument(
      "user-1",
      {
        role: "superuser",
      }
    );

    const db = createDb([document]);

    const result =
      await backfillUserRoles({
        db,
        admin,
      });

    expect(
      document.ref.set
    ).toHaveBeenCalledWith(
      {
        role: "user",
        updatedAt:
          "mock-server-timestamp",
      },
      {
        merge: true,
      }
    );

    expect(
      result.invalidRoles
    ).toBe(1);

    expect(
      result.rolesWritten
    ).toBe(1);
  });

  test("completes successfully when there are no users", async () => {
    const db = createDb([]);

    const result =
      await backfillUserRoles({
        db,
        admin,
      });

    expect(result).toEqual({
      usersScanned: 0,
      missingRoles: 0,
      invalidRoles: 0,
      validRolesPreserved: 0,
      rolesWritten: 0,
      errors: 0,
    });
  });

  test("dry run reports missing roles without writing", async () => {
    const document = createDocument(
      "user-1",
      {}
    );

    const db = createDb([document]);

    const result =
      await backfillUserRoles({
        db,
        admin,
        dryRun: true,
      });

    expect(
      document.ref.set
    ).not.toHaveBeenCalled();

    expect(
      result.missingRoles
    ).toBe(1);

    expect(
      result.rolesWritten
    ).toBe(0);
  });
});