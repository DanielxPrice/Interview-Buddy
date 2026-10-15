const FirestoreUserRepository = require(
  "./FirestoreUserRepository"
);

describe("FirestoreUserRepository", () => {
  let db;
  let admin;
  let repository;

  let setMock;
  let getMock;
  let updateMock;
  let docMock;
  let whereMock;
  let limitMock;
  let collectionMock;

  beforeEach(() => {
    jest.clearAllMocks();

    setMock = jest.fn();
    getMock = jest.fn();
    updateMock = jest.fn();

    docMock = jest.fn(() => ({
      set: setMock,
      get: getMock,
      update: updateMock,
    }));

    limitMock = jest.fn();

    whereMock = jest.fn(() => ({
      limit: limitMock,
    }));

    collectionMock = jest.fn(() => ({
      doc: docMock,
      where: whereMock,
    }));

    db = {
      collection: collectionMock,
    };

    admin = {
      firestore: {
        FieldValue: {
          serverTimestamp: jest.fn(
            () => "mock-server-timestamp"
          ),
        },
      },
    };

    repository = new FirestoreUserRepository({
      db,
      admin,
    });
  });

  describe("createProfile", () => {
    test("creates a normalized user profile", async () => {
      limitMock.mockReturnValue({
        get: jest.fn().mockResolvedValue({
          empty: true,
          docs: [],
        }),
      });

      setMock.mockResolvedValue();

      const result =
        await repository.createProfile({
          uid: " user-123 ",
          username: " TestUser ",
          email: " test@example.com ",
        });

      expect(
        collectionMock
      ).toHaveBeenCalledWith("users");

      expect(docMock).toHaveBeenCalledWith(
        "user-123"
      );

      expect(setMock).toHaveBeenCalledWith({
        uid: "user-123",
        username: "TestUser",
        usernameLower: "testuser",
        email: "test@example.com",
        role: "user",

        settings: {
          theme: "light",
        },

        createdAt: "mock-server-timestamp",
        updatedAt: "mock-server-timestamp",
      });

      expect(result).toEqual({
        uid: "user-123",
        username: "TestUser",
        usernameLower: "testuser",
        email: "test@example.com",
        role: "user",

        settings: {
          theme: "light",
        },

        createdAt: "mock-server-timestamp",
        updatedAt: "mock-server-timestamp",
      });
    });

    test("rejects a username owned by another user", async () => {
      limitMock.mockReturnValue({
        get: jest.fn().mockResolvedValue({
          empty: false,
          docs: [
            {
              id: "different-user",
              data: () => ({
                uid: "different-user",
                username: "TestUser",
                usernameLower: "testuser",
              }),
            },
          ],
        }),
      });

      await expect(
        repository.createProfile({
          uid: "user-123",
          username: "TestUser",
          email: "test@example.com",
        })
      ).rejects.toMatchObject({
        code: "username-already-exists",
        message:
          "That username is already in use.",
      });

      expect(setMock).not.toHaveBeenCalled();
    });

    test("rejects missing required fields", async () => {
      await expect(
        repository.createProfile({
          uid: "",
          username: "",
          email: "",
        })
      ).rejects.toThrow(
        "uid, username, and email are required to create a user profile."
      );

      expect(setMock).not.toHaveBeenCalled();
    });
  });

  describe("findByUsername", () => {
    test("performs a lowercase username lookup", async () => {
      const queryGet =
        jest.fn().mockResolvedValue({
          empty: false,
          docs: [
            {
              id: "user-123",
              data: () => ({
                uid: "user-123",
                username: "TestUser",
                usernameLower: "testuser",
                email: "test@example.com",
              }),
            },
          ],
        });

      limitMock.mockReturnValue({
        get: queryGet,
      });

      const result =
        await repository.findByUsername(
          "  TESTUSER  "
        );

      expect(whereMock).toHaveBeenCalledWith(
        "usernameLower",
        "==",
        "testuser"
      );

      expect(limitMock).toHaveBeenCalledWith(1);

      expect(result).toEqual({
        id: "user-123",
        uid: "user-123",
        username: "TestUser",
        usernameLower: "testuser",
        email: "test@example.com",
      });
    });

    test("returns null when no profile exists", async () => {
      limitMock.mockReturnValue({
        get: jest.fn().mockResolvedValue({
          empty: true,
          docs: [],
        }),
      });

      const result =
        await repository.findByUsername(
          "missinguser"
        );

      expect(result).toBeNull();
    });

    test("returns null for an empty username", async () => {
      const result =
        await repository.findByUsername(" ");

      expect(result).toBeNull();

      expect(whereMock).not.toHaveBeenCalled();
    });
  });

  describe("findById", () => {
    test("returns the stored user profile", async () => {
      getMock.mockResolvedValue({
        exists: true,
        id: "user-123",
        data: () => ({
          uid: "user-123",
          username: "TestUser",
          usernameLower: "testuser",
          email: "test@example.com",
        }),
      });

      const result =
        await repository.findById("user-123");

      expect(docMock).toHaveBeenCalledWith(
        "user-123"
      );

      expect(result).toEqual({
        id: "user-123",
        uid: "user-123",
        username: "TestUser",
        usernameLower: "testuser",
        email: "test@example.com",
      });
    });

    test("returns null when user does not exist", async () => {
      getMock.mockResolvedValue({
        exists: false,
      });

      const result =
        await repository.findById("user-123");

      expect(result).toBeNull();
    });

    test("returns null for an empty user id", async () => {
      const result =
        await repository.findById(" ");

      expect(result).toBeNull();

      expect(docMock).not.toHaveBeenCalled();
    });
  });

  describe("updateProfile", () => {
    test("updates username and display name", async () => {
      // First get() checks whether the document exists.
      // Second get() occurs through findById() after the update.
      getMock
        .mockResolvedValueOnce({
          exists: true,
          id: "user-123",
          data: () => ({
            uid: "user-123",
            username: "OldUser",
            usernameLower: "olduser",
            email: "test@example.com",
          }),
        })
        .mockResolvedValueOnce({
          exists: true,
          id: "user-123",
          data: () => ({
            uid: "user-123",
            username: "NewUser",
            usernameLower: "newuser",
            displayName: "New Name",
            email: "test@example.com",
            updatedAt:
              "mock-server-timestamp",
          }),
        });

      // Username availability check.
      limitMock.mockReturnValue({
        get: jest.fn().mockResolvedValue({
          empty: true,
          docs: [],
        }),
      });

      updateMock.mockResolvedValue();

      const result =
        await repository.updateProfile(
          " user-123 ",
          {
            username: " NewUser ",
            displayName: " New Name ",
          }
        );

      expect(updateMock).toHaveBeenCalledWith({
        username: "NewUser",
        usernameLower: "newuser",
        displayName: "New Name",
        updatedAt:
          "mock-server-timestamp",
      });

      expect(result).toEqual({
        id: "user-123",
        uid: "user-123",
        username: "NewUser",
        usernameLower: "newuser",
        displayName: "New Name",
        email: "test@example.com",
        updatedAt:
          "mock-server-timestamp",
      });
    });

    test("rejects an empty uid", async () => {
      await expect(
        repository.updateProfile("", {
          username: "NewUser",
        })
      ).rejects.toThrow(
        "uid is required to update a user profile."
      );

      expect(updateMock).not.toHaveBeenCalled();
    });

    test("returns null when the user does not exist", async () => {
      getMock.mockResolvedValue({
        exists: false,
      });

      const result =
        await repository.updateProfile(
          "user-123",
          {
            displayName: "New Name",
          }
        );

      expect(result).toBeNull();

      expect(updateMock).not.toHaveBeenCalled();
    });

    test("rejects an empty username", async () => {
      getMock.mockResolvedValue({
        exists: true,
        id: "user-123",
        data: () => ({
          uid: "user-123",
        }),
      });

      await expect(
        repository.updateProfile(
          "user-123",
          {
            username: "   ",
          }
        )
      ).rejects.toThrow(
        "Username cannot be empty."
      );

      expect(updateMock).not.toHaveBeenCalled();
    });

    test("rejects a username owned by another user", async () => {
      getMock.mockResolvedValue({
        exists: true,
        id: "user-123",
        data: () => ({
          uid: "user-123",
        }),
      });

      limitMock.mockReturnValue({
        get: jest.fn().mockResolvedValue({
          empty: false,
          docs: [
            {
              id: "different-user",
              data: () => ({
                uid: "different-user",
                username: "TakenUser",
                usernameLower: "takenuser",
              }),
            },
          ],
        }),
      });

      await expect(
        repository.updateProfile(
          "user-123",
          {
            username: "TakenUser",
          }
        )
      ).rejects.toMatchObject({
        code: "username-already-exists",
        message:
          "That username is already in use.",
      });

      expect(updateMock).not.toHaveBeenCalled();
    });

    test("allows keeping the same username", async () => {
      getMock
        .mockResolvedValueOnce({
          exists: true,
          id: "user-123",
          data: () => ({
            uid: "user-123",
            username: "TestUser",
          }),
        })
        .mockResolvedValueOnce({
          exists: true,
          id: "user-123",
          data: () => ({
            uid: "user-123",
            username: "TestUser",
            usernameLower: "testuser",
          }),
        });

      limitMock.mockReturnValue({
        get: jest.fn().mockResolvedValue({
          empty: false,
          docs: [
            {
              id: "user-123",
              data: () => ({
                uid: "user-123",
                username: "TestUser",
                usernameLower: "testuser",
              }),
            },
          ],
        }),
      });

      updateMock.mockResolvedValue();

      await expect(
        repository.updateProfile(
          "user-123",
          {
            username: "TestUser",
          }
        )
      ).resolves.toEqual({
        id: "user-123",
        uid: "user-123",
        username: "TestUser",
        usernameLower: "testuser",
      });

      expect(updateMock).toHaveBeenCalledWith({
        username: "TestUser",
        usernameLower: "testuser",
        updatedAt:
          "mock-server-timestamp",
      });
    });
  });

  describe("getSettings", () => {
    test("returns stored user settings", async () => {
      getMock.mockResolvedValue({
        exists: true,
        id: "user-123",
        data: () => ({
          uid: "user-123",
          username: "TestUser",
          settings: {
            theme: "dark",
            notifications: true,
          },
        }),
      });

      const result =
        await repository.getSettings(
          "user-123"
        );

      expect(result).toEqual({
        theme: "dark",
        notifications: true,
      });
    });

    test("returns an empty object when the user has no settings", async () => {
      getMock.mockResolvedValue({
        exists: true,
        id: "user-123",
        data: () => ({
          uid: "user-123",
          username: "TestUser",
        }),
      });

      const result =
        await repository.getSettings(
          "user-123"
        );

      expect(result).toEqual({});
    });

    test("returns null when the user does not exist", async () => {
      getMock.mockResolvedValue({
        exists: false,
      });

      const result =
        await repository.getSettings(
          "user-123"
        );

      expect(result).toBeNull();
    });
  });

  describe("updateSettings", () => {
    test("updates user settings", async () => {
      // Initial existence/data lookup.
      getMock
        .mockResolvedValueOnce({
          exists: true,
          id: "user-123",
          data: () => ({
            uid: "user-123",
            settings: {},
          }),
        })
        // getSettings() -> findById() after update
        .mockResolvedValueOnce({
          exists: true,
          id: "user-123",
          data: () => ({
            uid: "user-123",
            settings: {
              theme: "dark",
              notifications: false,
            },
          }),
        });

      updateMock.mockResolvedValue();

      const result =
        await repository.updateSettings(
          " user-123 ",
          {
            theme: "dark",
            notifications: false,
          }
        );

      expect(updateMock).toHaveBeenCalledWith({
        settings: {
          theme: "dark",
          notifications: false,
        },
        updatedAt:
          "mock-server-timestamp",
      });

      expect(result).toEqual({
        theme: "dark",
        notifications: false,
      });
    });

    test("merges settings with existing settings", async () => {
      getMock
        .mockResolvedValueOnce({
          exists: true,
          id: "user-123",
          data: () => ({
            uid: "user-123",
            settings: {
              theme: "light",
              notifications: true,
            },
          }),
        })
        .mockResolvedValueOnce({
          exists: true,
          id: "user-123",
          data: () => ({
            uid: "user-123",
            settings: {
              theme: "dark",
              notifications: true,
            },
          }),
        });

      updateMock.mockResolvedValue();

      const result =
        await repository.updateSettings(
          "user-123",
          {
            theme: "dark",
          }
        );

      expect(updateMock).toHaveBeenCalledWith({
        settings: {
          theme: "dark",
          notifications: true,
        },
        updatedAt:
          "mock-server-timestamp",
      });

      expect(result).toEqual({
        theme: "dark",
        notifications: true,
      });
    });

    test("rejects an empty uid", async () => {
      await expect(
        repository.updateSettings("", {
          theme: "dark",
        })
      ).rejects.toThrow(
        "uid is required to update settings."
      );

      expect(updateMock).not.toHaveBeenCalled();
    });

    test("returns null when the user does not exist", async () => {
      getMock.mockResolvedValue({
        exists: false,
      });

      const result =
        await repository.updateSettings(
          "user-123",
          {
            theme: "dark",
          }
        );

      expect(result).toBeNull();

      expect(updateMock).not.toHaveBeenCalled();
    });

    test("rejects an invalid theme", async () => {
      getMock.mockResolvedValue({
        exists: true,
        id: "user-123",
        data: () => ({
          uid: "user-123",
          settings: {},
        }),
      });

      await expect(
        repository.updateSettings(
          "user-123",
          {
            theme: "blue",
          }
        )
      ).rejects.toThrow(
        "theme must be either light or dark."
      );

      expect(updateMock).not.toHaveBeenCalled();
    });

    test("rejects a non-boolean notifications value", async () => {
      getMock.mockResolvedValue({
        exists: true,
        id: "user-123",
        data: () => ({
          uid: "user-123",
          settings: {},
        }),
      });

      await expect(
        repository.updateSettings(
          "user-123",
          {
            notifications: "yes",
          }
        )
      ).rejects.toThrow(
        "notifications must be a boolean."
      );

      expect(updateMock).not.toHaveBeenCalled();
    });
  });
});