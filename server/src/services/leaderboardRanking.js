"use strict";

// SCRUM-85: Ranking is based on SCRUM-84 session points, NOT Sprint 5 ELO.
// Equal point totals share a competition rank (1, 1, 3).
const GLOBAL_LEADERBOARD_LIMIT = 50;

function toEligibleProfile(profile) {
  if (!profile || typeof profile !== "object") return null;
  const uid = typeof profile.uid === "string" ? profile.uid.trim() : "";
  const username = typeof profile.username === "string"
    ? profile.username.trim() : "";
  const { ranking } = profile;

  if (!uid || !username || profile.deleting === true || profile.status === "deleting") {
    return null;
  }
  if (!ranking || typeof ranking !== "object" || Array.isArray(ranking)) return null;

  const { points, rankedSessions, averageScore } = ranking;
  if (
    !Number.isSafeInteger(points) || points < 0 ||
    !Number.isSafeInteger(rankedSessions) || rankedSessions < 1 ||
    points > rankedSessions * 100 ||
    !Number.isFinite(averageScore) || averageScore < 0 || averageScore > 100 ||
    Math.abs(averageScore - Math.round((points / rankedSessions) * 100) / 100) > 0.001
  ) {
    return null;
  }

  return { uid, username, points, rankedSessions, averageScore };
}

function compareAscending(first, second) {
  return first < second ? -1 : first > second ? 1 : 0;
}

function rankProfiles(profiles) {
  if (!Array.isArray(profiles)) throw new TypeError("Ranking profiles must be an array.");

  const eligible = profiles.map(toEligibleProfile).filter(Boolean);
  eligible.sort((a, b) =>
    b.points - a.points ||
    compareAscending(a.username.toLowerCase(), b.username.toLowerCase()) ||
    compareAscending(a.uid, b.uid)
  );

  let currentRank = 0;
  return eligible.map((entry, index) => {
    if (index === 0 || entry.points !== eligible[index - 1].points) {
      currentRank = index + 1;
    }

    return {
      ...entry,
      rank: currentRank,
      // No ELO exists yet. The frontend must not confuse points with ELO.
      elo: null,
    };
  });
}

module.exports = { GLOBAL_LEADERBOARD_LIMIT, rankProfiles };