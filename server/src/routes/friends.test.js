
"use strict";

jest.mock("../firebaseAdmin", () => ({
  admin: { auth: jest.fn() },
}));

const express = require("express");
const request = require("supertest");
const { admin } = require("../firebaseAdmin");
const requireAuth = require("../middleware/requireAuth");
const createFriendsRouter = require("./friends");

const alice = {
  id: "alice",
  uid: "alice",
  username: "Alice",
  email: "private@example.test",
  role: "admin",
};

const bob = {
  id: "bob",
  uid: "bob",
  username: "Bob",
  email: "bob-private@example.test",
};

const carol = {
  id: "carol",
  uid: "carol",
  username: "Carol",
  email: "carol-private@example.test",
};

const users = { alice, bob, carol };

const pending = {
  id: "relationship-1",
  requesterUid: "alice",
  recipientUid: "bob",
  status: "pending",
  secret: "never-expose",
};

function signedIn(app, uid = "alice") {
  return {
    get: (path) =>
      request(app)
        .get(path)
        .set("Authorization", `Bearer token-${uid}`),

    post: (path) =>
      request(app)
        .post(path)
        .set("Authorization", `Bearer token-${uid}`),

    delete: (path) =>
      request(app)
        .delete(path)
        .set("Authorization", `Bearer token-${uid}`),
  };
}

function fixture() {
  const userRepository = {
    findByUsername: jest.fn(async (username) =>
      Object.values(users).find(
        (row) =>
          row.username.toLowerCase() === username.toLowerCase()
      ) || null
    ),

    findById: jest.fn(async (uid) => users[uid] || null),
  };

  const friendshipRepository = {
    createRequest: jest.fn(async (requesterUid, recipientUid) => ({
      ...pending,
      requesterUid,
      recipientUid,
    })),

    acceptRequest: jest.fn(async (requesterUid, recipientUid) => ({
      ...pending,
      requesterUid,
      recipientUid,
      status: "accepted",
    })),

    declineRequest: jest.fn(async (requesterUid, recipientUid) => ({
      ...pending,
      requesterUid,
      recipientUid,
      status: "declined",
    })),

    listIncomingRequests: jest.fn().mockResolvedValue([]),
    listOutgoingRequests: jest.fn().mockResolvedValue([]),
    listFriends: jest.fn().mockResolvedValue([]),
    removeFriendship: jest.fn().mockResolvedValue(true),
  };

  const app = express();

  app.use(express.json());

  app.use(
    "/api/friends",
    requireAuth,
    createFriendsRouter({
      userRepository,
      friendshipRepository,
    })
  );

  app.use((_error, _req, res, _next) => {
    res.status(500).json({
      error: "Internal server error.",
    });
  });

  return {
    app,
    userRepository,
    friendshipRepository,
  };
}

beforeEach(() => {
  jest.clearAllMocks();

  admin.auth.mockReturnValue({
    verifyIdToken: jest.fn(async (token) => {
      const uid = token?.replace(/^token-/, "");

      if (!token?.startsWith("token-") || !users[uid]) {
        throw Object.assign(new Error("invalid"), {
          code: "auth/argument-error",
        });
      }

      return {
        uid,
        email: `${uid}@example.test`,
        email_verified: true,
        role: "user",
      };
    }),
  });
});

describe("SCRUM-109 application friend-request routes", () => {
  test("sends request using verified identity", async () => {
    const f = fixture();

    const response = await signedIn(f.app)
      .post("/api/friends/requests")
      .send({
        username: "  bOb  ",
        requesterUid: "carol",
      });

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe(
      "private, no-store"
    );

    expect(response.body.request).toEqual({
      id: "relationship-1",
      requesterUid: "alice",
      recipientUid: "bob",
      status: "pending",
    });

    expect(f.userRepository.findByUsername).toHaveBeenCalledWith(
      "bOb"
    );

    expect(f.friendshipRepository.createRequest).toHaveBeenCalledWith(
      "alice",
      "bob"
    );

    expect(JSON.stringify(response.body)).not.toContain(
      "private@example.test"
    );
    expect(JSON.stringify(response.body)).not.toContain(
      "never-expose"
    );
  });

  test("repeated pending submissions remain successful", async () => {
    const f = fixture();

    const first = await signedIn(f.app)
      .post("/api/friends/requests")
      .send({ username: "Bob" });

    const second = await signedIn(f.app)
      .post("/api/friends/requests")
      .send({ username: "Bob" });

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(first.body).toEqual(second.body);

    expect(
      f.friendshipRepository.createRequest
    ).toHaveBeenCalledTimes(2);
  });

  test.each([
    null,
    "",
    " ",
    7,
    {},
    "x".repeat(129),
    "bad\nname",
  ])("rejects invalid username %s", async (username) => {
    const f = fixture();

    const response = await signedIn(f.app)
      .post("/api/friends/requests")
      .send({ username });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe(
      "invalid-friend-username"
    );

    expect(
      f.userRepository.findByUsername
    ).not.toHaveBeenCalled();

    expect(
      f.friendshipRepository.createRequest
    ).not.toHaveBeenCalled();
  });

  test("unknown username returns 404", async () => {
    const f = fixture();

    const response = await signedIn(f.app)
      .post("/api/friends/requests")
      .send({ username: "Unknown" });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe(
      "friend-user-not-found"
    );

    expect(
      f.friendshipRepository.createRequest
    ).not.toHaveBeenCalled();
  });

  test("self-request is blocked", async () => {
    const f = fixture();

    const response = await signedIn(f.app)
      .post("/api/friends/requests")
      .send({ username: "aLiCe" });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe(
      "self-friend-request"
    );
  });

  test("deleting account cannot receive requests", async () => {
    const f = fixture();

    f.userRepository.findByUsername.mockResolvedValueOnce({
      ...bob,
      deleting: true,
    });

    const response = await signedIn(f.app)
      .post("/api/friends/requests")
      .send({ username: "Bob" });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe(
      "friend-user-unavailable"
    );
  });

  test("missing and invalid tokens are rejected", async () => {
    const f = fixture();

    const noToken = await request(f.app)
      .post("/api/friends/requests")
      .send({ username: "Bob" });

    const badToken = await request(f.app)
      .post("/api/friends/requests")
      .set("Authorization", "Bearer invalid-token")
      .send({ username: "Bob" });

    expect(noToken.status).toBe(401);
    expect(badToken.status).toBe(401);

    expect(
      f.friendshipRepository.createRequest
    ).not.toHaveBeenCalled();
  });

  test("repository conflicts return controlled errors", async () => {
    const f = fixture();

    f.friendshipRepository.createRequest.mockRejectedValueOnce(
      Object.assign(
        new Error(
          "A request from the other user is already pending."
        ),
        {
          code: "friend-request-pending",
          statusCode: 409,
        }
      )
    );

    const response = await signedIn(f.app)
      .post("/api/friends/requests")
      .send({ username: "Bob" });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe(
      "friend-request-pending"
    );
  });

  test("recipient accepts incoming request", async () => {
    const f = fixture();

    const response = await signedIn(f.app, "bob")
      .post("/api/friends/requests/alice/accept")
      .send({ actorUid: "alice" });

    expect(response.status).toBe(200);
    expect(response.body.request.status).toBe(
      "accepted"
    );

    expect(
      f.friendshipRepository.acceptRequest
    ).toHaveBeenCalledWith(
      "alice",
      "bob",
      "bob"
    );
  });

  test("recipient declines incoming request", async () => {
    const f = fixture();

    const response = await signedIn(f.app, "bob")
      .post("/api/friends/requests/alice/decline");

    expect(response.status).toBe(200);
    expect(response.body.request.status).toBe(
      "declined"
    );

    expect(
      f.friendshipRepository.declineRequest
    ).toHaveBeenCalledWith(
      "alice",
      "bob",
      "bob"
    );
  });

  test("unauthorized acceptance returns 403", async () => {
    const f = fixture();

    f.friendshipRepository.acceptRequest.mockRejectedValueOnce(
      Object.assign(
        new Error("Only the recipient may respond."),
        {
          code: "friend-request-forbidden",
          statusCode: 403,
        }
      )
    );

    const response = await signedIn(f.app)
      .post("/api/friends/requests/alice/accept");

    expect(response.status).toBe(403);
    expect(response.body.code).toBe(
      "friend-request-forbidden"
    );
  });

  test("pending lists expose only public user data", async () => {
    const f = fixture();

    f.friendshipRepository.listIncomingRequests.mockResolvedValueOnce([
      {
        ...pending,
        requesterUid: "carol",
        recipientUid: "bob",
      },
    ]);

    f.friendshipRepository.listOutgoingRequests.mockResolvedValueOnce([
      {
        ...pending,
        requesterUid: "bob",
        recipientUid: "alice",
      },
    ]);

    const response = await signedIn(f.app, "bob")
      .get("/api/friends/requests?uid=alice");

    expect(response.status).toBe(200);

    expect(
      f.friendshipRepository.listIncomingRequests
    ).toHaveBeenCalledWith("bob", "pending");

    expect(
      f.friendshipRepository.listOutgoingRequests
    ).toHaveBeenCalledWith("bob", "pending");

    expect(response.body.incoming[0].user).toEqual({
      uid: "carol",
      username: "Carol",
    });

    expect(response.body.outgoing[0].user).toEqual({
      uid: "alice",
      username: "Alice",
    });

    expect(JSON.stringify(response.body)).not.toContain(
      "@example.test"
    );

    expect(JSON.stringify(response.body)).not.toContain(
      "never-expose"
    );
  });

  test("accepted friends return public profiles", async () => {
    const f = fixture();

    f.friendshipRepository.listFriends.mockResolvedValueOnce([
      { friendUid: "carol" },
      { friendUid: "alice" },
    ]);

    const response = await signedIn(f.app, "bob")
      .get("/api/friends");

    expect(response.status).toBe(200);

    expect(
      f.friendshipRepository.listFriends
    ).toHaveBeenCalledWith("bob");

    expect(response.body).toEqual({
      friends: [
        { uid: "carol", username: "Carol" },
        { uid: "alice", username: "Alice" },
      ],
    });

    expect(JSON.stringify(response.body)).not.toContain(
      "email"
    );
    expect(JSON.stringify(response.body)).not.toContain(
      "role"
    );
  });

  test("removes friendship using verified identity", async () => {
    const f = fixture();

    const response = await signedIn(f.app, "bob")
      .delete("/api/friends/alice?uid=carol");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      removed: true,
    });

    expect(
      f.friendshipRepository.removeFriendship
    ).toHaveBeenCalledWith(
      "bob",
      "alice"
    );
  });

  test("rejects invalid requester UID", async () => {
    const f = fixture();

    const response = await signedIn(f.app, "bob")
      .post("/api/friends/requests/bad%2Fuid/accept");

    expect(response.status).toBe(400);

    expect(
      f.friendshipRepository.acceptRequest
    ).not.toHaveBeenCalled();
  });

  test("unknown backend failures are sanitized", async () => {
    const f = fixture();

    f.friendshipRepository.createRequest.mockRejectedValueOnce(
      new Error("internal database secret")
    );

    const response = await signedIn(f.app)
      .post("/api/friends/requests")
      .send({ username: "Bob" });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: "Internal server error.",
    });
  });
});
