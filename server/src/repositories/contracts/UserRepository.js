/**
 * Data-access contract for Interview Buddy user profiles.
 *
 * Authentication credentials remain in Firebase Authentication.
 * Application profile data such as username is persisted separately.
 */
class UserRepository {
  constructor() {
    if (new.target === UserRepository) {
      throw new Error(
        "UserRepository is an interface and cannot be instantiated directly."
      );
    }
  }

  //Registration & General
  async createProfile(profile) {
    throw new Error("createProfile() must be implemented.");
  }

  async findById(userId) {
    throw new Error("findById() must be implemented.");
  }

  async findByUsername(username) {
    throw new Error("findByUsername() must be implemented.");
  }

  //Profile & Settings
  async updateProfile(uid, updates) {
    throw new Error("updateProfile(uid, updates) must be implemented.");
  }

  async getSettings(uid) {
    throw new Error("getSettings(uid) must be implemented.");
  }

  async updateSettings(uid, settings) {
    throw new Error("updateSettings(uid, settings) must be implemented.");
  }
}

module.exports = UserRepository;