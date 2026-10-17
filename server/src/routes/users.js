const express = require("express");

/**
 * User/profile application routes.
 *
 * req.user is expected to be populated by Firebase authentication
 * middleware before these routes are mounted.
 */
function createUserRouter({ userRepository }) {
  if (!userRepository) {
    throw new Error(
      "createUserRouter requires userRepository."
    );
  }

  const router = express.Router();

  /**
   * Helper used by routes that require an authenticated user.
   */
  function requireUser(req, res) {
    if (!req.user?.uid) {
      res.status(401).json({
        error: "Authentication is required.",
      });

      return false;
    }

    return true;
  }

  // ---------------------------------------------------------
  // POST /api/users/profile
  //
  // Creates the application profile associated with the
  // authenticated Firebase user.
  //
  // Body:
  // {
  //   username: "exampleUser"
  // }
  // ---------------------------------------------------------
  router.post("/profile", async (req, res, next) => {
    try {
      if (!requireUser(req, res)) {
        return;
      }

      const username = String(
        req.body?.username || ""
      ).trim();

      if (!username) {
        return res.status(400).json({
          error: "Username is required.",
        });
      }

      const existingUser =
        await userRepository.findByUsername(username);

      if (
        existingUser &&
        existingUser.uid !== req.user.uid
      ) {
        return res.status(409).json({
          error: "That username is already in use.",
          code: "username-already-exists",
        });
      }

      const profile =
        await userRepository.createProfile({
          uid: req.user.uid,
          username,
          email: req.user.email || "",
        });

      return res.status(201).json({
        profile,
      });
    } catch (error) {
      if (error.code === "username-already-exists") {
        return res.status(409).json({
          error: error.message,
          code: error.code,
        });
      }

      return next(error);
    }
  });

  // ---------------------------------------------------------
  // GET /api/users/profile
  //
  // Returns the persisted application profile belonging to the
  // currently authenticated Firebase user.
  // ---------------------------------------------------------
  router.get("/profile", async (req, res, next) => {
    try {
      if (!requireUser(req, res)) {
        return;
      }

      const profile =
        await userRepository.findById(req.user.uid);

      if (!profile) {
        return res.status(404).json({
          error: "User profile was not found.",
          code: "profile-not-found",
        });
      }

      return res.status(200).json({
        profile,
      });
    } catch (error) {
      return next(error);
    }
  });

  // ---------------------------------------------------------
  // PATCH /api/users/profile
  //
  // Updates supported profile fields for the currently
  // authenticated user.
  //
  // Body may contain:
  // {
  //   username: "newUsername",
  //   displayName: "New Display Name"
  // }
  // ---------------------------------------------------------
  router.patch("/profile", async (req, res, next) => {
    try {
      if (!requireUser(req, res)) {
        return;
      }

      const updates = {};

      if (req.body?.username !== undefined) {
        const username = String(
          req.body.username || ""
        ).trim();

        if (!username) {
          return res.status(400).json({
            error: "Username cannot be empty.",
          });
        }

        updates.username = username;
      }

      if (req.body?.displayName !== undefined) {
        updates.displayName = String(
          req.body.displayName || ""
        ).trim();
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({
          error:
            "At least one supported profile field must be provided.",
        });
      }

      const profile =
        await userRepository.updateProfile(
          req.user.uid,
          updates
        );

      if (!profile) {
        return res.status(404).json({
          error: "User profile was not found.",
          code: "profile-not-found",
        });
      }

      return res.status(200).json({
        profile,
      });
    } catch (error) {
      if (error.code === "username-already-exists") {
        return res.status(409).json({
          error: error.message,
          code: error.code,
        });
      }

      return next(error);
    }
  });

  // ---------------------------------------------------------
  // GET /api/users/settings
  //
  // Returns persisted settings for the authenticated user.
  // ---------------------------------------------------------
  router.get("/settings", async (req, res, next) => {
    try {
      if (!requireUser(req, res)) {
        return;
      }

      const settings =
        await userRepository.getSettings(req.user.uid);

      if (settings === null) {
        return res.status(404).json({
          error: "User profile was not found.",
          code: "profile-not-found",
        });
      }

      return res.status(200).json({
        settings,
      });
    } catch (error) {
      return next(error);
    }
  });

  // ---------------------------------------------------------
  // PATCH /api/users/settings
  //
  // Updates supported settings for the authenticated user.
  //
  // Body may contain:
  // {
  //   theme: "light" | "dark",
  //   notifications: true | false
  // }
  // ---------------------------------------------------------
  router.patch("/settings", async (req, res, next) => {
    try {
      if (!requireUser(req, res)) {
        return;
      }

      const updates = {};

      if (req.body?.theme !== undefined) {
        const theme = String(req.body.theme).trim();

        if (!["light", "dark"].includes(theme)) {
          return res.status(400).json({
            error:
              'Theme must be either "light" or "dark".',
          });
        }

        updates.theme = theme;
      }

      if (req.body?.notifications !== undefined) {
        if (
          typeof req.body.notifications !== "boolean"
        ) {
          return res.status(400).json({
            error:
              "Notifications must be a boolean.",
          });
        }

        updates.notifications =
          req.body.notifications;
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({
          error:
            "At least one supported setting must be provided.",
        });
      }

      const settings =
        await userRepository.updateSettings(
          req.user.uid,
          updates
        );

      if (settings === null) {
        return res.status(404).json({
          error: "User profile was not found.",
          code: "profile-not-found",
        });
      }

      return res.status(200).json({
        settings,
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = createUserRouter;