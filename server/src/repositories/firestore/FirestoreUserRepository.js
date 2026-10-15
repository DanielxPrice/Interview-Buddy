const UserRepository = require("../contracts/UserRepository");
const {
  DEFAULT_USER_ROLE,
} = require("../../config/roles");

class FirestoreUserRepository extends UserRepository {
  constructor({ db, admin }) {
    super();

    if (!db) {
      throw new Error(
        "FirestoreUserRepository requires a Firestore db instance."
      );
    }

    this.db = db;
    this.admin = admin;
  }

  getTimestamp(fallbackValue) {
    return this.admin?.firestore?.FieldValue?.serverTimestamp
      ? this.admin.firestore.FieldValue.serverTimestamp()
      : fallbackValue || new Date().toISOString();
  }

  async createProfile({
    uid,
    username,
    email,
  }) {
    const normalizedUid = String(uid || "").trim();
    const normalizedUsername = String(username || "").trim();
    const normalizedEmail = String(email || "").trim();
    const usernameLower = normalizedUsername.toLowerCase();

    if (
      !normalizedUid ||
      !normalizedUsername ||
      !normalizedEmail
    ) {
      throw new Error(
        "uid, username, and email are required to create a user profile."
      );
    }

    const existingUser =
      await this.findByUsername(normalizedUsername);

    if (existingUser && existingUser.uid !== normalizedUid) {
      const error = new Error(
        "That username is already in use."
      );

      error.code = "username-already-exists";

      throw error;
    }

    const timestamp = this.getTimestamp();

    const profile = {
      uid: normalizedUid,
      username: normalizedUsername,
      usernameLower,
      email: normalizedEmail,
      role: DEFAULT_USER_ROLE,
      settings: {theme: "light",},
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.db
      .collection("users")
      .doc(normalizedUid)
      .set(profile);

    return profile;
  }

  async findById(userId) {
    const normalizedUserId = String(userId || "").trim();

    if (!normalizedUserId) {
      return null;
    }

    const document = await this.db
      .collection("users")
      .doc(normalizedUserId)
      .get();

    if (!document.exists) {
      return null;
    }

    return {
      id: document.id,
      ...document.data(),
    };
  }

  async findByUsername(username) {
    const normalizedUsername = String(
      username || ""
    )
      .trim()
      .toLowerCase();

    if (!normalizedUsername) {
      return null;
    }

    const snapshot = await this.db
      .collection("users")
      .where(
        "usernameLower",
        "==",
        normalizedUsername
      )
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    const document = snapshot.docs[0];

    return {
      id: document.id,
      ...document.data(),
    };
  }

  async updateProfile(uid, updates = {}) {
    const normalizedUid = String(uid || "").trim();

    //Uid for update
    if (!normalizedUid) {
      throw new Error("uid is required to update a user profile.");
    }

    //Find reference
    const userRef = this.db
      .collection("users")
      .doc(normalizedUid);

    const existingDocument = await userRef.get();

    if (!existingDocument.exists) {
      return null;
    }

    const allowedUpdates = {};

    if (updates.username !== undefined) {
      const normalizedUsername = String(
        updates.username || ""
      ).trim();

      //Check username empty / in use
      if (!normalizedUsername) {
        throw new Error("Username cannot be empty.");
      }

      const existingUser =
        await this.findByUsername(normalizedUsername);

      if (
        existingUser &&
        existingUser.uid !== normalizedUid
      ) {
        const error = new Error(
          "That username is already in use."
        );

        error.code = "username-already-exists";

        throw error;
      }

      //Set allowed update for username
      allowedUpdates.username = normalizedUsername;
      allowedUpdates.usernameLower =
        normalizedUsername.toLowerCase();
    }

    if (updates.displayName !== undefined) {
      const normalizedDisplayName = String(
        updates.displayName || ""
      ).trim();

      allowedUpdates.displayName =
        normalizedDisplayName;
    }

    allowedUpdates.updatedAt =
      this.getTimestamp();

    await userRef.update(allowedUpdates);

    return this.findById(normalizedUid);
  }

  //Find by id, check if null, return settings
  async getSettings(uid) {
    const user = await this.findById(uid);

    if (!user) {
      return null;
    }

    return user.settings || {};
  }

  async updateSettings(uid, settings = {}) {
    const normalizedUid = String(uid || "").trim();

    if (!normalizedUid) {
      throw new Error("uid is required to update settings.");
    }

    const userRef = this.db
      .collection("users")
      .doc(normalizedUid);

    const existingDocument = await userRef.get();

    if (!existingDocument.exists) {
      return null;
    }

    const allowedSettings = {};

    if (settings.theme !== undefined) {
      if (!["light", "dark"].includes(settings.theme)) {
        throw new Error(
          "theme must be either light or dark."
        );
      }

      allowedSettings.theme = settings.theme;
    }

    if (settings.notifications !== undefined) {
      if (
        typeof settings.notifications !== "boolean"
      ) {
        throw new Error(
          "notifications must be a boolean."
        );
      }

      allowedSettings.notifications =
        settings.notifications;
    }

    //Merge w/ existing data
    const existingData = existingDocument.data();

    const updatedSettings = {
      ...(existingData.settings || {}),
      ...allowedSettings,
    };

    await userRef.update({
      settings: updatedSettings,
      updatedAt: this.getTimestamp(),
    });

    return this.getSettings(normalizedUid);
  }
}

module.exports = FirestoreUserRepository;