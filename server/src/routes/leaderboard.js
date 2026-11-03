"use strict";

const express = require("express");
const { GLOBAL_LEADERBOARD_LIMIT, rankProfiles } = require("../services/leaderboardRanking");

function createLeaderboardRouter({ userRepository }) {
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

  router.get("/global", (req, res, next) => getRankings(req, res, next, "global"));
  router.get("/me", (req, res, next) => getRankings(req, res, next, "me"));
  return router;
}

module.exports = createLeaderboardRouter;