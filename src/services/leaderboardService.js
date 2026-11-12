import { auth } from "../config/firebase";

const API_BASE_URL = (
  process.env.REACT_APP_API_BASE_URL || "http://localhost:5001/api"
).replace(/\/$/, "");

/**
 * Frontend-only contract for future database-backed leaderboard/friend APIs.
 *
 * These endpoints DO NOT exist in the current backend. A 404/501 is reported
 * as feature-unavailable, never treated as a successful empty result.
 * All requests use the current Firebase ID token; the React client does not
 * access Firestore directly (the project's Firestore rules forbid that).
 *
 * Future expected responses:
 *   GET /leaderboard/global  -> { rankings: [{ uid, username, rank, elo }] }
 *   GET /leaderboard/friends -> { rankings: [{ uid, username, rank, elo }] }
 *   GET /leaderboard/me     -> { ranking: { uid, username, rank, elo } | null }
 *   POST /friends/requests  -> friend request accepted; body { username }
 *   DELETE /friends/:uid   -> accepted friendship removed
 *
 * No mock values or local mutations are returned from this service.
 */
async function request(path, options = {}) {
  const user = auth.currentUser;
  if (!user) {
    const error = new Error("Sign in to view leaderboard and friends data.");
    error.code = "authentication-required";
    throw error;
  }

  const token = await user.getIdToken();
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${token}`,
      },
    });
  } catch (cause) {
    const error = new Error("Unable to connect to the ranking service. Please try again.");
    error.code = "connection-failed";
    throw error;
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch (_) {
    // Unimplemented routes may return an HTML 404 page instead of JSON.
  }

  if (!response.ok) {
    if (
      (response.status === 404 || response.status === 501) &&
      !payload?.code
    ) {
      const error = new Error("Ranking and friends data is not available yet.");
      error.code = "feature-unavailable";
      throw error;
    }
    if (response.status === 401 || response.status === 403) {
      const error = new Error("You do not have permission to access this data.");
      error.code = "access-denied";
      throw error;
    }
    const error = new Error(payload?.error || payload?.message || "Unable to retrieve ranking information.");
    error.code = payload?.code || "request-failed";
    throw error;
  }

  return payload;
}

function normalizeRanking(row) {
  if (
    !row ||
    typeof row !== "object" ||
    typeof row.username !== "string" ||
    !row.username.trim()
  ) {
    throw new Error(
      "The server returned an invalid ranking record."
    );
  }

  const rank = Number(row.rank);
  const elo = Number(row.elo);
  const points = Number(row.points);
  const rankedSessions = Number(row.rankedSessions);
  const averageScore = Number(row.averageScore);

  return {
    uid: row.uid ?? row.userId ?? row.id ?? null,

    username: row.username.trim(),

    rank:
      row.rank != null &&
      Number.isInteger(rank) &&
      rank > 0
        ? rank
        : null,

    elo:
      row.elo != null &&
      row.elo !== "" &&
      Number.isFinite(elo)
        ? elo
        : null,

    points:
      row.points != null &&
      row.points !== "" &&
      Number.isSafeInteger(points) &&
      points >= 0
        ? points
        : null,

    rankedSessions:
      row.rankedSessions != null &&
      row.rankedSessions !== "" &&
      Number.isSafeInteger(rankedSessions) &&
      rankedSessions >= 0
        ? rankedSessions
        : null,

    averageScore:
      row.averageScore != null &&
      row.averageScore !== "" &&
      Number.isFinite(averageScore) &&
      averageScore >= 0 &&
      averageScore <= 100
        ? averageScore
        : null,
  };
}

function parseRankings(payload) {
  const records = Array.isArray(payload) ? payload : payload?.rankings;
  if (!Array.isArray(records)) {
    throw new Error("The server returned an invalid leaderboard response.");
  }
  return records.map(normalizeRanking).sort((a, b) =>
    (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER)
  );
}

export const leaderboardService = {
  async getGlobalLeaderboard() {
    return parseRankings(await request("/leaderboard/global"));
  },

  async getFriendsLeaderboard() {
    return parseRankings(await request("/leaderboard/friends"));
  },

  // The backend, not a supplied client user ID, determines which user is "me".
  async getUserRanking() {
    const payload = await request("/leaderboard/me");
    if (!payload || !Object.prototype.hasOwnProperty.call(payload, "ranking")) {
      throw new Error("The server returned an invalid personal ranking response.");
    }
    return payload.ranking == null ? null : normalizeRanking(payload.ranking);
  },


  //For accepted friends that do not have a ranking (wont appear in leaderboard)
  async getAcceptedFriends() {
    const payload = await request("/friends");

    if (!Array.isArray(payload?.friends)) {
      throw new Error(
        "The server returned an invalid friends response."
      );
    }

    return payload.friends.map((friend) => {
      if (
        !friend ||
        typeof friend.uid !== "string" ||
        !friend.uid.trim() ||
        typeof friend.username !== "string" ||
        !friend.username.trim()
      ) {
        throw new Error(
          "The server returned an invalid friend record."
        );
      }

      return {
        uid: friend.uid,
        username: friend.username.trim(),
      };
    }).sort((a, b) =>
      a.username.localeCompare(b.username)
    );
  },

  //Uses existing authenticated request helper to retrieve pending incoming and outgoing
  //requests from Firebase through backend
  async getFriendRequests() {
    const payload = await request("/friends/requests");

    if (
      !Array.isArray(payload?.incoming) ||
      !Array.isArray(payload?.outgoing)
    ) {
      throw new Error(
        "The server returned an invalid friend requests response."
      );
    }

    return {
      incoming: payload.incoming,
      outgoing: payload.outgoing,
    };
  },

  //Friend related endpoints
  async sendFriendRequest(username) {
    const name = String(username || "").trim();
    if (!name) throw new Error("Enter a username to send a friend request.");
    return request("/friends/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: name }),
    });
  },

  async acceptFriendRequest(requesterUid) {
    if (typeof requesterUid !== "string" || !requesterUid.trim()) {
      throw new Error("A requester UID is required.");
    }

    return request(
      `/friends/requests/${encodeURIComponent(requesterUid)}/accept`,
      { method: "POST" }
    );
  },

  async declineFriendRequest(requesterUid) {
    if (typeof requesterUid !== "string" || !requesterUid.trim()) {
      throw new Error("A requester UID is required.");
    }

    return request(
      `/friends/requests/${encodeURIComponent(requesterUid)}/decline`,
      { method: "POST" }
    );
  },

  async removeFriend(uid) {
    if (uid === undefined || uid === null || uid === "") {
      throw new Error("A friend user ID is required.");
    }
    return request(`/friends/${encodeURIComponent(uid)}`, { method: "DELETE" });
  },
};
