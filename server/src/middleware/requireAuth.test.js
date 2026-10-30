
jest.mock("../firebaseAdmin", () => ({
  admin: {
    auth: jest.fn(),
  },
}));

const { admin } = require("../firebaseAdmin");
const requireAuth = require("./requireAuth");

function makeRequest(
  header = "Bearer test-token"
) {
  return {
    get: jest.fn(() => header),
  };
}

function makeResponse() {
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

describe("SEC-02 Firebase authentication admission", () => {
  let verifyIdToken;
  let getUser;

  beforeEach(() => {
    jest.clearAllMocks();

    verifyIdToken = jest.fn();
    getUser = jest.fn();

    admin.auth.mockReturnValue({
      verifyIdToken,
      getUser,
    });
  });

  test("accepts a verified ordinary user and checks revocation", async () => {
    verifyIdToken.mockResolvedValue({
      uid: "u1",
      email: "user@example.com",
      email_verified: true,
      role: "user",
    });

    const req = makeRequest();
    const res = makeResponse();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(verifyIdToken).toHaveBeenCalledWith(
      "test-token",
      true
    );

    expect(req.user).toEqual({
      uid: "u1",
      email: "user@example.com",
      emailVerified: true,
      role: "user",
    });

    expect(getUser).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  test("rejects requests without a valid Bearer header", async () => {
    for (const header of [
      "",
      "Basic abc",
      "Bearer ",
      "Bearer token another",
    ]) {
      const res = makeResponse();
      const next = jest.fn();

      await requireAuth(
        makeRequest(header),
        res,
        next
      );

      expect(res.statusCode).toBe(401);
      expect(res.payload.code).toBe(
        "auth-token-required"
      );
      expect(next).not.toHaveBeenCalled();
    }

    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  test.each([
    ["expired", "auth/id-token-expired"],
    ["revoked", "auth/id-token-revoked"],
    ["disabled", "auth/user-disabled"],
    ["deleted", "auth/user-not-found"],
  ])("rejects %s tokens", async (_label, code) => {
    verifyIdToken.mockRejectedValue(
      Object.assign(new Error(code), {
        code,
      })
    );

    const res = makeResponse();
    const next = jest.fn();

    await requireAuth(
      makeRequest(),
      res,
      next
    );

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();

    expect(verifyIdToken).toHaveBeenCalledWith(
      "test-token",
      true
    );
  });

  test("does not trust an old admin claim after a downgrade", async () => {
    verifyIdToken.mockResolvedValue({
      uid: "admin1",
      role: "admin",
      email_verified: true,
    });

    getUser.mockResolvedValue({
      uid: "admin1",
      customClaims: {
        role: "user",
      },
    });

    const req = makeRequest();
    const res = makeResponse();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(getUser).toHaveBeenCalledWith(
      "admin1"
    );

    expect(req.user.role).toBe("user");
    expect(next).toHaveBeenCalledTimes(1);
  });

  test("accepts a current admin claim after checking Firebase", async () => {
    verifyIdToken.mockResolvedValue({
      uid: "admin1",
      role: "admin",
    });

    getUser.mockResolvedValue({
      uid: "admin1",
      customClaims: {
        role: "admin",
      },
    });

    const req = makeRequest();
    const res = makeResponse();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(req.user.role).toBe("admin");
    expect(next).toHaveBeenCalledTimes(1);
  });

  test("fails closed if Firebase token verification is unavailable", async () => {
    verifyIdToken.mockRejectedValue(
      Object.assign(
        new Error("backend down"),
        {
          code: "auth/network-request-failed",
        }
      )
    );

    const res = makeResponse();
    const next = jest.fn();

    await requireAuth(
      makeRequest(),
      res,
      next
    );

    expect(res.statusCode).toBe(503);
    expect(res.payload.code).toBe(
      "auth-verification-unavailable"
    );
    expect(next).not.toHaveBeenCalled();
  });

  test("accepts case-insensitive bearer schemes", async () => {
    verifyIdToken.mockResolvedValue({
      uid: "u1",
    });

    const req = makeRequest(
      "bearer token"
    );

    const next = jest.fn();

    await requireAuth(
      req,
      makeResponse(),
      next
    );

    expect(verifyIdToken).toHaveBeenCalledWith(
      "token",
      true
    );

    expect(next).toHaveBeenCalledTimes(1);
  });
});
