
const createRequireAccountReady =
  require("./requireAccountReady");

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

function makeRequest({
  path = "/api/questions",
  method = "GET",
  user,
} = {}) {
  const isUser = path.startsWith("/api/users/");

  return {
    baseUrl: isUser
      ? "/api/users"
      : "/api/questions",

    path: isUser
      ? path.slice("/api/users".length)
      : "/",

    method,

    user: user === undefined
      ? {
          uid: "u1",
          email: "user@example.com",
          emailVerified: true,
        }
      : user,
  };
}

describe("SEC-02 backend account readiness gate", () => {
  let findById;
  let middleware;

  beforeEach(() => {
    findById = jest.fn().mockResolvedValue({
      uid: "u1",
      username: "username",
    });

    middleware = createRequireAccountReady({
      userRepository: {
        findById,
      },
    });
  });

  async function execute(options) {
    const req = makeRequest(options);
    const res = makeResponse();
    const next = jest.fn();

    await middleware(req, res, next);

    return {
      req,
      res,
      next,
    };
  }

  test("allows a verified user with an owned profile", async () => {
    const { req, next } = await execute();

    expect(next).toHaveBeenCalledTimes(1);

    expect(req.accountProfile.uid).toBe("u1");

    expect(findById).toHaveBeenCalledWith(
      "u1"
    );
  });

  test("permits only onboarding profile GET/POST and account DELETE", async () => {
    for (const [path, method] of [
      ["/api/users/profile", "GET"],
      ["/api/users/profile", "POST"],
      ["/api/users/account", "DELETE"],
    ]) {
      const { next } = await execute({
        path,
        method,
        user: {
          uid: "u1",
          emailVerified: false,
        },
      });

      expect(next).toHaveBeenCalledTimes(1);
    }

    expect(findById).not.toHaveBeenCalled();
  });

  test("rejects missing or mismatched profiles", async () => {
    for (const profile of [
      null,
      { uid: "another" },
    ]) {
      findById.mockResolvedValueOnce(profile);

      const { res, next } = await execute();

      expect(res.statusCode).toBe(403);

      expect(res.payload.code).toBe(
        "account-profile-required"
      );

      expect(next).not.toHaveBeenCalled();
    }
  });

  test("blocks unverified email and anonymous accounts", async () => {
    for (const user of [
      {
        uid: "u1",
        email: "user@example.com",
        emailVerified: false,
      },
      {
        uid: "u1",
        email: "",
        emailVerified: true,
      },
    ]) {
      const { res, next } = await execute({
        user,
      });

      expect(res.statusCode).toBe(403);

      expect(res.payload.code).toBe(
        "email-verification-required"
      );

      expect(next).not.toHaveBeenCalled();
    }
  });

  test("blocks accounts being deleted", async () => {
    findById.mockResolvedValue({
      uid: "u1",
      status: "deleting",
    });

    const { res, next } = await execute();

    expect(res.statusCode).toBe(403);

    expect(res.payload.code).toBe(
      "account-deletion-in-progress"
    );

    expect(next).not.toHaveBeenCalled();
  });

  test("denies requests without authenticated user context", async () => {
    const { res, next } = await execute({
      user: null,
    });

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  test("forwards repository failures rather than admitting the request", async () => {
    const failure = new Error(
      "Firestore unavailable"
    );

    findById.mockRejectedValue(failure);

    const { next } = await execute();

    expect(next).toHaveBeenCalledWith(
      failure
    );
  });
});
