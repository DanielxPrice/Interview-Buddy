const {
  syncAuthUsersToFirestore,
} = require(
  "./authUserProfileSync"
);

jest.mock("../config/roles", () => ({
  DEFAULT_USER_ROLE: "user",
  VALID_USER_ROLES: new Set([
    "user",
    "admin",
  ]),
}));

function createAdmin() {
  return {
    firestore: {
      FieldValue: {
        serverTimestamp: jest.fn(
          () => "mock-server-timestamp"
        ),
      },
    },
  };
}

function createAuth(users) {
  return {
    listUsers: jest.fn().mockResolvedValue({
      users,
      pageToken: undefined,
    }),
  };
}

function createDb(initialDocuments = {}) {
  const documents = new Map(
    Object.entries(initialDocuments)
  );

  const setMocks = new Map();

  const collection = {
    get: jest.fn().mockImplementation(
      async () => ({
        docs: Array.from(
          documents.entries()
        ).map(([id, data]) => ({
          id,
          data: () => data,
        })),
      })
    ),

    doc: jest.fn((uid) => {
      if (!setMocks.has(uid)) {
        setMocks.set(
          uid,
          jest.fn().mockImplementation(
            async (updates) => {
              documents.set(uid, {
                ...(documents.get(uid) || {}),
                ...updates,
              });
            }
          )
        );
      }

      return {
        set: setMocks.get(uid),
      };
    }),
  };

  return {
    db: {
      collection: jest.fn(
        () => collection
      ),
    },
    documents,
    setMocks,
  };
}

describe(
  "syncAuthUsersToFirestore",
  () => {
    test(
      "creates a missing Firestore profile",
      async () => {
        const auth = createAuth([
          {
            uid: "user-123",
            email:
              "daniel@example.com",
            displayName: "Daniel",
            customClaims: {},
            metadata: {
              creationTime:
                "2026-09-01T12:00:00.000Z",
            },
          },
        ]);

        const { db, documents } =
          createDb();

        const { summary } =
          await syncAuthUsersToFirestore({
            auth,
            db,
            admin: createAdmin(),
          });

        expect(
            documents.get("user-123")
        ).toMatchObject({
            uid: "user-123",
            username: "Daniel",
            usernameLower: "daniel",
            email: "daniel@example.com",
            role: "user",

            settings: {
                theme: "light",
            },
        });

        expect(
          summary.missingProfiles
        ).toBe(1);

        expect(
          summary.profilesWritten
        ).toBe(1);
      }
    );

    test(
    "adds default settings to an existing profile that has none",
    async () => {
        const auth = createAuth([
        {
            uid: "user-123",
            email: "user@example.com",
            displayName: "User",
        },
        ]);

        const {
        db,
        documents,
        } = createDb({
        "user-123": {
            uid: "user-123",
            username: "User",
            usernameLower: "user",
            email: "user@example.com",
            role: "user",
            createdAt: "old-date",
        },
        });

        const { summary } =
        await syncAuthUsersToFirestore({
            auth,
            db,
            admin: createAdmin(),
        });

        expect(
        documents.get("user-123").settings
        ).toEqual({
        theme: "light",
        });

        expect(
        summary.incompleteProfiles
        ).toBe(1);

        expect(
        summary.profilesWritten
        ).toBe(1);
    }
    );

    test(
    "preserves existing user settings",
    async () => {
        const auth = createAuth([
        {
            uid: "user-123",
            email: "user@example.com",
            displayName: "User",
        },
        ]);

        const {
        db,
        documents,
        } = createDb({
        "user-123": {
            uid: "user-123",
            username: "User",
            usernameLower: "user",
            email: "user@example.com",
            role: "user",

            settings: {
            theme: "dark",
            },

            createdAt: "old-date",
        },
        });

        await syncAuthUsersToFirestore({
        auth,
        db,
        admin: createAdmin(),
        });

        expect(
        documents.get("user-123").settings
        ).toEqual({
        theme: "dark",
        });
    }
    );

    test(
      "uses an authenticated admin claim for a new profile",
      async () => {
        const auth = createAuth([
          {
            uid: "admin-123",
            email:
              "admin@example.com",
            displayName: "Admin",
            customClaims: {
              role: "admin",
            },
          },
        ]);

        const { db, documents } =
          createDb();

        await syncAuthUsersToFirestore({
          auth,
          db,
          admin: createAdmin(),
        });

        expect(
          documents.get("admin-123")
            .role
        ).toBe("admin");
      }
    );

    test(
      "does not overwrite a complete existing profile",
      async () => {
        const auth = createAuth([
          {
            uid: "admin-123",
            email:
              "admin@example.com",
            displayName: "Different Name",
            customClaims: {
              role: "admin",
            },
          },
        ]);

        const originalProfile = {
          uid: "admin-123",
          username:
            "ExistingUsername",
          usernameLower:
            "existingusername",
          email:
            "admin@example.com",
          role: "admin",
          createdAt: "old-date",
          settings: {
            theme: "dark",
          },
        };

        const {
          db,
          setMocks,
        } = createDb({
          "admin-123":
            originalProfile,
        });

        const { summary } =
          await syncAuthUsersToFirestore({
            auth,
            db,
            admin: createAdmin(),
          });

        expect(
          setMocks.has("admin-123")
        ).toBe(false);

        expect(
          summary.completeProfiles
        ).toBe(1);
      }
    );

    test(
      "repairs missing fields without overwriting settings or role",
      async () => {
        const auth = createAuth([
          {
            uid: "user-123",
            email:
              "user@example.com",
            displayName: "User Name",
          },
        ]);

        const {
          db,
          documents,
        } = createDb({
          "user-123": {
            uid: "user-123",
            role: "admin",
            settings: {
              theme: "dark",
            },
          },
        });

        await syncAuthUsersToFirestore({
          auth,
          db,
          admin: createAdmin(),
        });

        const repaired =
          documents.get("user-123");

        expect(repaired.role).toBe(
          "admin"
        );

        expect(
          repaired.settings
        ).toEqual({
          theme: "dark",
        });

        expect(repaired).toMatchObject({
          uid: "user-123",
          username: "User Name",
          usernameLower:
            "user name",
          email:
            "user@example.com",
        });
      }
    );

    test(
      "generates unique usernames when names collide",
      async () => {
        const auth = createAuth([
          {
            uid: "abcdef123",
            email:
              "another@example.com",
            displayName: "Daniel",
          },
        ]);

        const {
          db,
          documents,
        } = createDb({
          "existing-user": {
            uid: "existing-user",
            username: "Daniel",
            usernameLower: "daniel",
            email:
              "existing@example.com",
            role: "user",
            createdAt: "existing",
          },
        });

        await syncAuthUsersToFirestore({
          auth,
          db,
          admin: createAdmin(),
        });

        expect(
          documents.get("abcdef123")
            .username
        ).toBe("Daniel-abcdef");
      }
    );

    test(
      "dry run reports changes without writing them",
      async () => {
        const auth = createAuth([
          {
            uid: "user-123",
            email:
              "user@example.com",
            displayName: "User",
          },
        ]);

        const {
          db,
          documents,
        } = createDb();

        const { summary, actions } =
          await syncAuthUsersToFirestore({
            auth,
            db,
            admin: createAdmin(),
            dryRun: true,
          });

        expect(
          documents.has("user-123")
        ).toBe(false);

        expect(
          summary.missingProfiles
        ).toBe(1);

        expect(
          summary.profilesWritten
        ).toBe(0);

        expect(
          actions[0].action
        ).toBe("would-create");
      }
    );
  }
);