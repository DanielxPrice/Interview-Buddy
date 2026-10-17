import mockLeaderboard from "../data/mockLeaderboard";
import mockFriends from "../data/mockFriends";

/**
 * React-facing leaderboard service facade.
 *
 * Sprint 1 exposes existing mock ranking data through service methods. Later
 * the implementation can be replaced by backend/Firebase queries.
 */
export const leaderboardService = {
  async getGlobalLeaderboard() {
    return mockLeaderboard
      .map((user) => ({ ...user }))
      .sort((a, b) => a.rank - b.rank);
  },

  async getFriendsLeaderboard() {
    return mockFriends
      .map((user) => ({ ...user }))
      .sort((a, b) => a.rank - b.rank);
  },

  async getUserRanking(userId) {
    if (userId === undefined || userId === null) {
      throw new Error("User ID is required.");
    }

    const user = mockLeaderboard.find(
      (item) => String(item.id) === String(userId)
    );

    return user ? { ...user } : null;
  },
};