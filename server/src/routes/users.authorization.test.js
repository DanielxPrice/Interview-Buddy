jest.mock("../firebaseAdmin", () => ({
  admin: {
    auth: jest.fn(),
  },
}));

//These tests verify the real HTTP request, Firebase authentication middleware, and user routes working together
//They intentionally dont include the rate limited and account-readiness middleware since those are separate concerns for now

const express = require("express");
const request = require("supertest");

const { admin } = require("../firebaseAdmin");
const requireAuth = require("../middleware/requireAuth");
const createUserRouter = require("./users");

describe("A-03 profile/settings HTTP authorization", () => {
  let app;
  let verifyIdToken;
  let userRepository;

  beforeEach(() => {
    jest.clearAllMocks();

    verifyIdToken = jest.fn();

    admin.auth.mockReturnValue({
      verifyIdToken,
      getUser: jest.fn(),
    });

    userRepository = {
      createProfile: jest.fn(),
      findById: jest.fn(),
      findByUsername: jest.fn(),
      updateProfile: jest.fn(),
      getSettings: jest.fn(),
      updateSettings: jest.fn(),
    };

    app = express();
    app.use(express.json());

    app.use(
      "/api/users",
      requireAuth,
      createUserRouter({ userRepository })
    );
  });

  it("rejects profile retrieval without a token", async () => {
    const response = await request(app)
      .get("/api/users/profile");

    expect(response.status).toBe(401);
    expect(response.body.code).toBe(
      "auth-token-required"
    );

    expect(verifyIdToken).not.toHaveBeenCalled();
    expect(userRepository.findById).not.toHaveBeenCalled();
  });

  it("rejects settings updates with an invalid token", async () => {
    verifyIdToken.mockRejectedValue(
      Object.assign(new Error("Invalid token"), {
        code: "auth/argument-error",
      })
    );

    const response = await request(app)
      .patch("/api/users/settings")
      .set("Authorization", "Bearer invalid-token")
      .send({
        theme: "dark",
      });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe(
      "invalid-auth-token"
    );

    expect(
      userRepository.updateSettings
    ).not.toHaveBeenCalled();
  });

  it("uses the verified Firebase identity rather than a spoofed UID", async () => {
    verifyIdToken.mockResolvedValue({
      uid: "user-a",
      email: "alice@example.com",
      role: "user",
    });

    userRepository.findById.mockResolvedValue({
      uid: "user-a",
      username: "alice",
    });

    const response = await request(app)
      .get("/api/users/profile")
      .set("Authorization", "Bearer valid-token")
      .query({
        uid: "user-b",
      });

    expect(response.status).toBe(200);

    expect(response.body.profile.uid).toBe("user-a");

    expect(userRepository.findById).toHaveBeenCalledWith(
      "user-a"
    );

    expect(userRepository.findById).not.toHaveBeenCalledWith(
      "user-b"
    );

    expect(verifyIdToken).toHaveBeenCalledWith(
      "valid-token",
      true
    );
  });
});