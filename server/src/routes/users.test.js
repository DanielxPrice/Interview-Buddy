const createUserRouter = require("./users");

function getRouteHandler(router, path, method) {
  const layer = router.stack.find(
    (entry) =>
      entry.route &&
      entry.route.path === path &&
      entry.route.methods[method]
  );

  return layer.route.stack[0].handle;
}

function createResponse() {
  return {
    statusCode: 200,
    payload: null,

    status(code) {
      this.statusCode = code;
      return this;
    },

    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

describe("users routes", () => {
  let userRepository;
  let router;

  beforeEach(() => {
    jest.clearAllMocks();

    userRepository = {
      createProfile: jest.fn(),
      findById: jest.fn(),
      findByUsername: jest.fn(),
      updateProfile: jest.fn(),
      getSettings: jest.fn(),
      updateSettings: jest.fn(),
    };

    router = createUserRouter({
      userRepository,
    });
  });

  describe("POST /api/users/profile", () => {
    let handler;

    beforeEach(() => {
      handler = getRouteHandler(
        router,
        "/profile",
        "post"
      );
    });

    it("creates a profile for the authenticated Firebase user", async () => {
      userRepository.findByUsername.mockResolvedValue(null);

      userRepository.createProfile.mockResolvedValue({
        uid: "user-123",
        username: "testuser",
        usernameLower: "testuser",
        email: "test@example.com",
      });

      const req = {
        user: {
          uid: "user-123",
          email: "test@example.com",
        },
        body: {
          username: "testuser",
        },
      };

      const res = createResponse();
      const next = jest.fn();

      await handler(req, res, next);

      expect(
        userRepository.findByUsername
      ).toHaveBeenCalledWith("testuser");

      expect(
        userRepository.createProfile
      ).toHaveBeenCalledWith({
        uid: "user-123",
        username: "testuser",
        email: "test@example.com",
      });

      expect(res.statusCode).toBe(201);

      expect(res.payload).toEqual({
        profile: {
          uid: "user-123",
          username: "testuser",
          usernameLower: "testuser",
          email: "test@example.com",
        },
      });

      expect(next).not.toHaveBeenCalled();
    });

    it("rejects requests without an authenticated user", async () => {
      const req = {
        body: {
          username: "testuser",
        },
      };

      const res = createResponse();

      await handler(req, res, jest.fn());

      expect(res.statusCode).toBe(401);

      expect(res.payload).toEqual({
        error: "Authentication is required.",
      });

      expect(
        userRepository.createProfile
      ).not.toHaveBeenCalled();
    });

    it("requires a username", async () => {
      const req = {
        user: {
          uid: "user-123",
          email: "test@example.com",
        },
        body: {},
      };

      const res = createResponse();

      await handler(req, res, jest.fn());

      expect(res.statusCode).toBe(400);

      expect(res.payload).toEqual({
        error: "Username is required.",
      });
    });

    it("rejects a username already owned by another user", async () => {
      userRepository.findByUsername.mockResolvedValue({
        uid: "different-user",
        username: "testuser",
      });

      const req = {
        user: {
          uid: "user-123",
          email: "test@example.com",
        },
        body: {
          username: "testuser",
        },
      };

      const res = createResponse();

      await handler(req, res, jest.fn());

      expect(res.statusCode).toBe(409);

      expect(res.payload).toEqual({
        error: "That username is already in use.",
        code: "username-already-exists",
      });

      expect(
        userRepository.createProfile
      ).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/users/profile", () => {
    let handler;

    beforeEach(() => {
      handler = getRouteHandler(
        router,
        "/profile",
        "get"
      );
    });

    it("returns the authenticated user's persisted profile", async () => {
      userRepository.findById.mockResolvedValue({
        uid: "user-123",
        username: "testuser",
        email: "test@example.com",
      });

      const req = {
        user: {
          uid: "user-123",
        },
      };

      const res = createResponse();
      const next = jest.fn();

      await handler(req, res, next);

      expect(
        userRepository.findById
      ).toHaveBeenCalledWith("user-123");

      expect(res.statusCode).toBe(200);

      expect(res.payload).toEqual({
        profile: {
          uid: "user-123",
          username: "testuser",
          email: "test@example.com",
        },
      });

      expect(next).not.toHaveBeenCalled();
    });

    it("returns 404 when the profile does not exist", async () => {
      userRepository.findById.mockResolvedValue(null);

      const req = {
        user: {
          uid: "user-123",
        },
      };

      const res = createResponse();

      await handler(req, res, jest.fn());

      expect(res.statusCode).toBe(404);

      expect(res.payload).toEqual({
        error: "User profile was not found.",
        code: "profile-not-found",
      });
    });

    it("rejects unauthenticated requests", async () => {
      const req = {};

      const res = createResponse();

      await handler(req, res, jest.fn());

      expect(res.statusCode).toBe(401);

      expect(
        userRepository.findById
      ).not.toHaveBeenCalled();
    });
  });

  describe("PATCH /api/users/profile", () => {
    let handler;

    beforeEach(() => {
      handler = getRouteHandler(
        router,
        "/profile",
        "patch"
      );
    });

    it("updates supported profile fields", async () => {
      userRepository.updateProfile.mockResolvedValue({
        uid: "user-123",
        username: "newname",
        displayName: "New Name",
      });

      const req = {
        user: {
          uid: "user-123",
        },
        body: {
          username: "newname",
          displayName: "New Name",
        },
      };

      const res = createResponse();
      const next = jest.fn();

      await handler(req, res, next);

      expect(
        userRepository.updateProfile
      ).toHaveBeenCalledWith("user-123", {
        username: "newname",
        displayName: "New Name",
      });

      expect(res.statusCode).toBe(200);

      expect(res.payload).toEqual({
        profile: {
          uid: "user-123",
          username: "newname",
          displayName: "New Name",
        },
      });

      expect(next).not.toHaveBeenCalled();
    });

    it("rejects an empty username", async () => {
      const req = {
        user: {
          uid: "user-123",
        },
        body: {
          username: "   ",
        },
      };

      const res = createResponse();

      await handler(req, res, jest.fn());

      expect(res.statusCode).toBe(400);

      expect(res.payload).toEqual({
        error: "Username cannot be empty.",
      });

      expect(
        userRepository.updateProfile
      ).not.toHaveBeenCalled();
    });

    it("rejects requests with no supported fields", async () => {
      const req = {
        user: {
          uid: "user-123",
        },
        body: {
          email: "changed@example.com",
        },
      };

      const res = createResponse();

      await handler(req, res, jest.fn());

      expect(res.statusCode).toBe(400);

      expect(
        userRepository.updateProfile
      ).not.toHaveBeenCalled();
    });

    it("returns 404 when the user profile does not exist", async () => {
      userRepository.updateProfile.mockResolvedValue(null);

      const req = {
        user: {
          uid: "user-123",
        },
        body: {
          displayName: "New Name",
        },
      };

      const res = createResponse();

      await handler(req, res, jest.fn());

      expect(res.statusCode).toBe(404);
    });

    it("returns 409 when the username is already in use", async () => {
      const error = new Error(
        "That username is already in use."
      );

      error.code = "username-already-exists";

      userRepository.updateProfile.mockRejectedValue(
        error
      );

      const req = {
        user: {
          uid: "user-123",
        },
        body: {
          username: "takenname",
        },
      };

      const res = createResponse();

      await handler(req, res, jest.fn());

      expect(res.statusCode).toBe(409);

      expect(res.payload).toEqual({
        error: "That username is already in use.",
        code: "username-already-exists",
      });
    });

    //Security testing
    it("uses the authenticated user's uid instead of a client supplied uid", async () => {
      userRepository.updateProfile.mockResolvedValue({
        uid: "user-123",
        displayName: "New Name",
      });

      const req = {
        user: {
          uid: "user-123",
        },
        body: {
          uid: "different-user",
          displayName: "New Name",
        },
      };

      const res = createResponse();
      const next = jest.fn();

      await handler(req, res, next);

      expect(
        userRepository.updateProfile
      ).toHaveBeenCalledWith("user-123", {
        displayName: "New Name",
      });

      expect(res.statusCode).toBe(200);
      expect(next).not.toHaveBeenCalled();
    });

    //Tests that a client cannot sneak protected/arbitrary fields into persistence
    it("filters unsupported profile fields before persistence", async () => {
      userRepository.updateProfile.mockResolvedValue({
        uid: "user-123",
        displayName: "New Name",
      });

      const req = {
        user: {
          uid: "user-123",
        },
        body: {
          displayName: "New Name",
          email: "changed@example.com",
          uid: "different-user",
          createdAt: "fake-created-date",
          updatedAt: "fake-updated-date",
          role: "admin",
        },
      };

      const res = createResponse();
      const next = jest.fn();

      await handler(req, res, next);

      expect(
        userRepository.updateProfile
      ).toHaveBeenCalledWith("user-123", {
        displayName: "New Name",
      });

      expect(
        userRepository.updateProfile
      ).not.toHaveBeenCalledWith(
        "different-user",
        expect.anything()
      );

      expect(res.statusCode).toBe(200);
      expect(next).not.toHaveBeenCalled();
    });

    //Ensures that normalization exists
    it("normalizes supported profile fields before persistence", async () => {
      userRepository.updateProfile.mockResolvedValue({
        uid: "user-123",
        username: "newname",
        displayName: "New Name",
      });

      const req = {
        user: {
          uid: "user-123",
        },
        body: {
          username: "  newname  ",
          displayName: "  New Name  ",
        },
      };

      const res = createResponse();

      await handler(req, res, jest.fn());

      expect(
        userRepository.updateProfile
      ).toHaveBeenCalledWith("user-123", {
        username: "newname",
        displayName: "New Name",
      });
    });
  });

  describe("GET /api/users/settings", () => {
    let handler;

    beforeEach(() => {
      handler = getRouteHandler(
        router,
        "/settings",
        "get"
      );
    });

    it("returns persisted settings for the authenticated user", async () => {
      userRepository.getSettings.mockResolvedValue({
        theme: "dark",
        notifications: true,
      });

      const req = {
        user: {
          uid: "user-123",
        },
      };

      const res = createResponse();
      const next = jest.fn();

      await handler(req, res, next);

      expect(
        userRepository.getSettings
      ).toHaveBeenCalledWith("user-123");

      expect(res.statusCode).toBe(200);

      expect(res.payload).toEqual({
        settings: {
          theme: "dark",
          notifications: true,
        },
      });

      expect(next).not.toHaveBeenCalled();
    });

    it("returns 404 when the user profile does not exist", async () => {
      userRepository.getSettings.mockResolvedValue(null);

      const req = {
        user: {
          uid: "user-123",
        },
      };

      const res = createResponse();

      await handler(req, res, jest.fn());

      expect(res.statusCode).toBe(404);
    });
  });

  describe("PATCH /api/users/settings", () => {
    let handler;

    beforeEach(() => {
      handler = getRouteHandler(
        router,
        "/settings",
        "patch"
      );
    });

    it("updates supported user settings", async () => {
      userRepository.updateSettings.mockResolvedValue({
        theme: "dark",
        notifications: false,
      });

      const req = {
        user: {
          uid: "user-123",
        },
        body: {
          theme: "dark",
          notifications: false,
        },
      };

      const res = createResponse();
      const next = jest.fn();

      await handler(req, res, next);

      expect(
        userRepository.updateSettings
      ).toHaveBeenCalledWith("user-123", {
        theme: "dark",
        notifications: false,
      });

      expect(res.statusCode).toBe(200);

      expect(res.payload).toEqual({
        settings: {
          theme: "dark",
          notifications: false,
        },
      });

      expect(next).not.toHaveBeenCalled();
    });

    it("rejects invalid theme values", async () => {
      const req = {
        user: {
          uid: "user-123",
        },
        body: {
          theme: "blue",
        },
      };

      const res = createResponse();

      await handler(req, res, jest.fn());

      expect(res.statusCode).toBe(400);

      expect(
        userRepository.updateSettings
      ).not.toHaveBeenCalled();
    });

    it("rejects non-boolean notification values", async () => {
      const req = {
        user: {
          uid: "user-123",
        },
        body: {
          notifications: "yes",
        },
      };

      const res = createResponse();

      await handler(req, res, jest.fn());

      expect(res.statusCode).toBe(400);

      expect(
        userRepository.updateSettings
      ).not.toHaveBeenCalled();
    });

    it("rejects requests with no supported settings", async () => {
      const req = {
        user: {
          uid: "user-123",
        },
        body: {
          language: "en",
        },
      };

      const res = createResponse();

      await handler(req, res, jest.fn());

      expect(res.statusCode).toBe(400);

      expect(
        userRepository.updateSettings
      ).not.toHaveBeenCalled();
    });

    it("returns 404 when the user profile does not exist", async () => {
      userRepository.updateSettings.mockResolvedValue(
        null
      );

      const req = {
        user: {
          uid: "user-123",
        },
        body: {
          theme: "dark",
        },
      };

      const res = createResponse();

      await handler(req, res, jest.fn());

      expect(res.statusCode).toBe(404);
    });

    it("uses the authenticated user's uid instead of a client supplied uid", async () => {
      userRepository.updateSettings.mockResolvedValue({
        theme: "dark",
      });

      const req = {
        user: {
          uid: "user-123",
        },
        body: {
          uid: "different-user",
          theme: "dark",
        },
      };

      const res = createResponse();
      const next = jest.fn();

      await handler(req, res, next);

      expect(
        userRepository.updateSettings
      ).toHaveBeenCalledWith("user-123", {
        theme: "dark",
      });

      expect(res.statusCode).toBe(200);
      expect(next).not.toHaveBeenCalled();
    });

    it("filters unsupported settings before persistence", async () => {
      userRepository.updateSettings.mockResolvedValue({
        theme: "dark",
        notifications: true,
      });

      const req = {
        user: {
          uid: "user-123",
        },
        body: {
          theme: "dark",
          notifications: true,
          uid: "different-user",
          role: "admin",
          language: "en",
        },
      };

      const res = createResponse();

      await handler(req, res, jest.fn());

      expect(
        userRepository.updateSettings
      ).toHaveBeenCalledWith("user-123", {
        theme: "dark",
        notifications: true,
      });
    });
  });

  //Verify behaviors that users.js already implemented
  describe("Additional route tests", () => {
    it("rejects a whitespace-only registration username", async () => {
      const handler = getRouteHandler(router, "/profile", "post");
      const req = {
        user: { uid: "user-123", email: "test@example.com" },
        body: { username: "   " },
      };
      const res = createResponse();

      await handler(req, res, jest.fn());

      expect(res.statusCode).toBe(400);
      expect(res.payload).toEqual({
        error: "Username is required.",
      });
      expect(userRepository.createProfile).not.toHaveBeenCalled();
    });

    it("trims registration usernames before persistence", async () => {
      const handler = getRouteHandler(router, "/profile", "post");
      userRepository.findByUsername.mockResolvedValue(null);
      userRepository.createProfile.mockResolvedValue({
        uid: "user-123",
        username: "TestUser",
      });

      const req = {
        user: { uid: "user-123", email: "test@example.com" },
        body: { username: "  TestUser  " },
      };
      const res = createResponse();

      await handler(req, res, jest.fn());

      expect(userRepository.findByUsername).toHaveBeenCalledWith(
        "TestUser"
      );
      expect(userRepository.createProfile).toHaveBeenCalledWith({
        uid: "user-123",
        username: "TestUser",
        email: "test@example.com",
      });
      expect(res.statusCode).toBe(201);
    });

    it("rejects unauthenticated profile updates", async () => {
      const handler = getRouteHandler(router, "/profile", "patch");
      const req = {
        body: { displayName: "Unauthorized Change" },
      };
      const res = createResponse();

      await handler(req, res, jest.fn());

      expect(res.statusCode).toBe(401);
      expect(res.payload).toEqual({
        error: "Authentication is required.",
      });
      expect(userRepository.updateProfile).not.toHaveBeenCalled();
    });

    it("rejects unauthenticated settings updates", async () => {
      const handler = getRouteHandler(router, "/settings", "patch");
      const req = {
        body: { theme: "dark" },
      };
      const res = createResponse();

      await handler(req, res, jest.fn());

      expect(res.statusCode).toBe(401);
      expect(res.payload).toEqual({
        error: "Authentication is required.",
      });
      expect(userRepository.updateSettings).not.toHaveBeenCalled();
    });
  });
  
  describe("route error handling", () => {
    it("returns 409 when profile creation detects a repository username conflict", async () => {
      const handler = getRouteHandler(router, "/profile", "post");

      userRepository.findByUsername.mockResolvedValue(null);

      const conflict = new Error("That username is already in use.");
      conflict.code = "username-already-exists";
      userRepository.createProfile.mockRejectedValue(conflict);

      const req = {
        user: { uid: "user-123", email: "test@example.com" },
        body: { username: "TakenUser" },
      };
      const res = createResponse();
      const next = jest.fn();

      await handler(req, res, next);

      expect(res.statusCode).toBe(409);
      expect(res.payload).toEqual({
        error: "That username is already in use.",
        code: "username-already-exists",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("rejects unauthenticated settings retrieval", async () => {
      const handler = getRouteHandler(router, "/settings", "get");
      const res = createResponse();

      await handler({}, res, jest.fn());

      expect(res.statusCode).toBe(401);
      expect(res.payload).toEqual({
        error: "Authentication is required.",
      });
      expect(userRepository.getSettings).not.toHaveBeenCalled();
    });

    it("preserves an explicit false notification setting", async () => {
      const handler = getRouteHandler(router, "/settings", "patch");

      userRepository.updateSettings.mockResolvedValue({
        notifications: false,
      });

      const req = {
        user: { uid: "user-123" },
        body: { notifications: false },
      };
      const res = createResponse();

      await handler(req, res, jest.fn());

      expect(userRepository.updateSettings).toHaveBeenCalledWith(
        "user-123",
        { notifications: false }
      );
      expect(res.statusCode).toBe(200);
      expect(res.payload).toEqual({
        settings: { notifications: false },
      });
    });

    it("forwards repository retrieval errors to Express", async () => {
      const handler = getRouteHandler(router, "/profile", "get");

      const databaseError = new Error("Firestore unavailable");
      userRepository.findById.mockRejectedValue(databaseError);

      const req = {
        user: { uid: "user-123" },
      };
      const res = createResponse();
      const next = jest.fn();

      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(databaseError);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});