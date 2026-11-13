const express = require("express");
const request = require("supertest");
const createLeaderboardRouter = require("./leaderboard");

const profile = (uid, elo, username = uid) => ({
  uid, username,
  ranking: { elo, rankedSessions: 1, points: 0, averageScore: 0 },
  email: `${uid}@private.example`,
  role: "admin",
});

function buildApp(userRepository, uid = "viewer", friendshipRepository = null) {
  const app = express();

  app.use("/api/leaderboard", (req, _res, next) => {
    if (uid) req.user = { uid };
    next();
  }, createLeaderboardRouter({ userRepository, friendshipRepository }));

  app.use((_error, _req, res, _next) => {
    res.status(500).json({ error: "Internal server error." });
  });

  return app;
}

describe("ELO leaderboard API contract", () => {
  const rows = [profile("viewer", 1050), profile("top", 1300), profile("low", 900)];
  let userRepository;
  let friendshipRepository;
  let app;

  beforeEach(() => {
    userRepository = {
      listRankingProfiles: jest.fn().mockResolvedValue(rows),
    };

    friendshipRepository = {
      listFriendsLeaderboard: jest.fn().mockResolvedValue([]),
    };

    app = buildApp(userRepository, "viewer", friendshipRepository);
  });

  test("GET /global returns rank-sorted public data", async () => {
    const response = await request(app).get("/api/leaderboard/global");
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body.rankings.map((row) => [row.uid, row.rank, row.elo]))
      .toEqual([["top", 1, 1300], ["viewer", 2, 1050], ["low", 3, 900]]);
    expect(response.body.rankings[0]).not.toHaveProperty("points");
    expect(JSON.stringify(response.body)).not.toContain("@private.example");
    expect(JSON.stringify(response.body)).not.toContain('"role"');
  });

  test("GET /me selects authenticated UID, not query parameters", async () => {
    const response = await request(app).get("/api/leaderboard/me?uid=top");
    expect(response.status).toBe(200);
    expect(response.body.ranking).toMatchObject({ uid: "viewer", rank: 2, elo: 1050 });
  });

  test("GET /me returns null for a user with no eligible ranked sessions", async () => {
    userRepository.listRankingProfiles.mockResolvedValue([profile("top", 90)]);
    const response = await request(app).get("/api/leaderboard/me");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ranking: null });
  });

  test("GET /global returns an empty array without ranks", async () => {
    userRepository.listRankingProfiles.mockResolvedValue([]);
    const response = await request(app).get("/api/leaderboard/global");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ rankings: [] });
  });

  test("GET /global returns at most 50 users", async () => {
    userRepository.listRankingProfiles.mockResolvedValue(
      Array.from({ length: 65 }, (_, i) => profile(`uid-${i}`, 1200 - i))
    );
    const response = await request(app).get("/api/leaderboard/global");
    expect(response.status).toBe(200);
    expect(response.body.rankings).toHaveLength(50);
    expect(response.body.rankings[0].elo).toBe(1200);
  });

  test("GET /me works when user is beyond the global top 50", async () => {
    userRepository.listRankingProfiles.mockResolvedValue([
      ...Array.from({ length: 51 }, (_, i) => profile(`uid-${i}`, 1200 - i)),
      profile("viewer", 900),
    ]);
    const response = await request(app).get("/api/leaderboard/me");
    expect(response.status).toBe(200);
    expect(response.body.ranking.rank).toBe(52);
  });

  //Test Friends endpoints
  test("GET /friends returns only public accepted-friend rankings", async () => {
    friendshipRepository.listFriendsLeaderboard.mockResolvedValue([
      {
        uid: "bob",
        username: "Bob",
        rank: 1,
        elo: 1200,
        email: "private@example.test",
        role: "admin",
      },
      {
        uid: "carol",
        username: "Carol",
        rank: 2,
        elo: 1000,
      },
    ]);

    const response = await request(app)
      .get("/api/leaderboard/friends?uid=someone-else");

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");

    expect(friendshipRepository.listFriendsLeaderboard)
      .toHaveBeenCalledWith("viewer");

    expect(userRepository.listRankingProfiles).not.toHaveBeenCalled();

    expect(response.body).toEqual({
      rankings: [
        {
          uid: "bob",
          username: "Bob",
          rank: 1,
          elo: 1200,
        },
        {
          uid: "carol",
          username: "Carol",
          rank: 2,
          elo: 1000,
        },
      ],
    });

    expect(JSON.stringify(response.body)).not.toContain("private@example.test");
    expect(JSON.stringify(response.body)).not.toContain('"role"');
  });

  test("GET /friends returns an empty list when there are no ranked friends", async () => {
    const response = await request(app)
      .get("/api/leaderboard/friends");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ rankings: [] });
  });

  test("GET /friends requires an authenticated UID", async () => {
    const response = await request(
      buildApp(userRepository, null, friendshipRepository)
    ).get("/api/leaderboard/friends");

    expect(response.status).toBe(401);
    expect(friendshipRepository.listFriendsLeaderboard)
      .not.toHaveBeenCalled();
  });

  test("GET /friends handles repository failures without leaking details", async () => {
    friendshipRepository.listFriendsLeaderboard.mockRejectedValue(
      new Error("Private Firestore detail")
    );

    const response = await request(app)
      .get("/api/leaderboard/friends");

    expect(response.status).toBe(500);
    expect(response.body.error).toBe("Internal server error.");
    expect(JSON.stringify(response.body))
      .not.toContain("Private Firestore detail");
  });

  test("GET /friends rejects malformed repository responses", async () => {
    friendshipRepository.listFriendsLeaderboard.mockResolvedValue(null);

    const response = await request(app)
      .get("/api/leaderboard/friends");

    expect(response.status).toBe(500);
    expect(response.body.error).toBe("Internal server error.");
  });

  test("requires an authenticated UID", async () => {
    const response = await request(buildApp(userRepository, null))
      .get("/api/leaderboard/global");
    expect(response.status).toBe(401);
    expect(userRepository.listRankingProfiles).not.toHaveBeenCalled();
  });

  test("returns a controlled error when reading profiles fails", async () => {
    userRepository.listRankingProfiles.mockRejectedValue(new Error("Private backend detail"));
    const response = await request(app).get("/api/leaderboard/global");
    expect(response.status).toBe(500);
    expect(response.body.error).toBe("Internal server error.");
    expect(JSON.stringify(response.body)).not.toContain("Private backend detail");
  });
});