"use strict";

// Rank by persisted ELO, not historical cumulative points. Equal ratings share
// competition rank (1, 1, 3). Legacy accounts without ELO start at 1000.
const { ELO_CONFIG } = require("./eloRating");
const GLOBAL_LEADERBOARD_LIMIT = 50;

function toEligibleProfile(profile) {
  if (!profile || typeof profile !== "object") return null;
  const uid = typeof profile.uid === "string" ? profile.uid.trim() : "";
  const username = typeof profile.username === "string" ? profile.username.trim() : "";
  const { ranking } = profile;
  if (!uid || !username || profile.deleting === true || profile.status === "deleting") {
    return null;
  }
  if (!ranking || typeof ranking !== "object" || Array.isArray(ranking)) return null;

  // Unranked accounts do not appear just for being created with ELO 1000.
  if (!Number.isSafeInteger(ranking.rankedSessions) || ranking.rankedSessions < 1) {
    return null;
  }
  const elo = ranking.elo == null ? ELO_CONFIG.initialElo : ranking.elo;
  if (!Number.isSafeInteger(elo) || elo < ELO_CONFIG.minimumElo) return null;
  return { uid, username, elo };
}

function compareAscending(first, second) {
  return first < second ? -1 : first > second ? 1 : 0;
}

function rankProfiles(profiles) {
  if (!Array.isArray(profiles)) throw new TypeError("Ranking profiles must be an array.");
  const eligible = profiles.map(toEligibleProfile).filter(Boolean);
  eligible.sort((a, b) =>
    b.elo - a.elo ||
    compareAscending(a.username.toLowerCase(), b.username.toLowerCase()) ||
    compareAscending(a.uid, b.uid)
  );
  let currentRank = 0;
  return eligible.map((entry, index) => {
    if (index === 0 || entry.elo !== eligible[index - 1].elo) {
      currentRank = index + 1;
    }
    return { ...entry, rank: currentRank };
  });
}

module.exports = { GLOBAL_LEADERBOARD_LIMIT, rankProfiles };
