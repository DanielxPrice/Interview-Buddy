"use strict";

const express = require("express");
const { GLOBAL_LEADERBOARD_LIMIT, rankProfiles } = require("../services/leaderboardRanking");

//Give leaderboard router access to friendship repo
function createLeaderboardRouter({ userRepository, friendshipRepository }) {
  const router = express.Router();

  // Parent app applies Firebase auth, API rate limits, and account-readiness checks.
  async function getRankings(req, res, next, mode) {
    if (!req.user?.uid) {
      return res.status(401).json({
        code: "auth-token-required",
        error: "Authentication is required.",
      });
    }

    try {
      if (typeof userRepository?.listRankingProfiles !== "function") {
        throw new Error("Ranking repository is unavailable.");
      }

      const rankings = rankProfiles(await userRepository.listRankingProfiles());
      res.set("Cache-Control", "private, no-store");

      if (mode === "me") {
        const ranking = rankings.find((item) => item.uid === req.user.uid) || null;
        return res.json({ ranking });
      }

      return res.json({ rankings: rankings.slice(0, GLOBAL_LEADERBOARD_LIMIT) });
    } catch (error) {
      return next(error);
    }
  }

  // Return rankings for accepted friends of the authenticated user.
  router.get("/friends", async (req, res, next) => {
    if (!req.user?.uid) {
      return res.status(401).json({
        code: "auth-token-required",
        error: "Authentication is required.",
      });
    }

    try {
      if (typeof friendshipRepository?.listFriendsLeaderboard !== "function") {
        throw new Error("Friends ranking repository is unavailable.");
      }

      const rankings = await friendshipRepository.listFriendsLeaderboard(req.user.uid);

      if (!Array.isArray(rankings)) {
        throw new Error("Friends ranking repository returned invalid data.");
      }

      res.set("Cache-Control", "private, no-store");

      return res.json({
        rankings: rankings.map(({
          uid, username, rank, elo,
        }) => ({ uid, username, rank, elo })),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/global", (req, res, next) => getRankings(req, res, next, "global"));
  router.get("/me", (req, res, next) => getRankings(req, res, next, "me"));
  return router;
}

module.exports = createLeaderboardRouter;