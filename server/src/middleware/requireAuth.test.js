jest.mock("../firebaseAdmin", () => ({
  admin: {
    auth: jest.fn(),
  },
}));

const { admin } = require("../firebaseAdmin");
const requireAuth = require("./requireAuth");

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

describe("requireAuth middleware", () => {
  let verifyIdToken;

  beforeEach(() => {
    jest.clearAllMocks();

    verifyIdToken = jest.fn();

    admin.auth.mockReturnValue({
      verifyIdToken,
    });
  });

  it("accepts a valid Firebase ID token", async () => {
    verifyIdToken.mockResolvedValue({
      uid: "user-123",
      email: "test@example.com",
      email_verified: true,
    });

    const req = {
      get: jest.fn().mockReturnValue(
        "Bearer valid-token"
      ),
    };

    const res = createResponse();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(verifyIdToken).toHaveBeenCalledWith(
      "valid-token"
    );

    expect(req.user).toEqual({
      uid: "user-123",
      email: "test@example.com",
      emailVerified: true,
      role: "user",
    });

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("rejects a request without a bearer token", async () => {
    const req = {
      get: jest.fn().mockReturnValue(""),
    };

    const res = createResponse();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(res.statusCode).toBe(401);

    expect(res.payload).toEqual({
      error: "Authentication is required.",
      code: "auth-token-required",
    });

    expect(verifyIdToken).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects an invalid Firebase ID token", async () => {
    verifyIdToken.mockRejectedValue(
      new Error("Invalid token")
    );

    const req = {
      get: jest.fn().mockReturnValue(
        "Bearer invalid-token"
      ),
    };

    const res = createResponse();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(res.statusCode).toBe(401);

    expect(res.payload).toEqual({
      error:
        "The authentication token is invalid or expired.",
      code: "invalid-auth-token",
    });

    expect(next).not.toHaveBeenCalled();
    expect(verifyIdToken).toHaveBeenCalledWith(
      "invalid-token"
    );
  });

  it("rejects a malformed authorization header", async () => {
    const req = {
      get: jest.fn().mockReturnValue(
        "Basic abc123"
      ),
    };

    const res = createResponse();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(res.statusCode).toBe(401);

    expect(res.payload).toEqual({
      error: "Authentication is required.",
      code: "auth-token-required",
    });

    expect(verifyIdToken).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("defaults missing email and verification fields safely", async () => {
    verifyIdToken.mockResolvedValue({
      uid: "user-123",
    });

    const req = {
      get: jest.fn().mockReturnValue(
        "Bearer valid-token"
      ),
    };

    const res = createResponse();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(req.user).toEqual({
      uid: "user-123",
      email: "",
      emailVerified: false,
      role: "user",
    });

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("copies a valid role claim into req.user", async () => {
    verifyIdToken.mockResolvedValue({
      uid: "admin-123",
      email: "admin@example.com",
      role: "admin",
    });

    const req = {
      get: jest.fn().mockReturnValue(
        "Bearer admin-token"
      ),
    };

    const res = createResponse();
    const next = jest.fn();

    await requireAuth(
      req,
      res,
      next
    );

    expect(
      req.user.role
    ).toBe("admin");

    expect(
      next
    ).toHaveBeenCalledTimes(1);
  });

  it("defaults an unknown role claim to user", async () => {
    verifyIdToken.mockResolvedValue({
      uid: "user-123",
      role: "superuser",
    });

    const req = {
      get: jest.fn().mockReturnValue(
        "Bearer valid-token"
      ),
    };

    const res = createResponse();
    const next = jest.fn();

    await requireAuth(
      req,
      res,
      next
    );

    expect(
      req.user.role
    ).toBe("user");

    expect(
      next
    ).toHaveBeenCalledTimes(1);
  });
});