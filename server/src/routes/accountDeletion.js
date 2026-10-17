
const express = require("express");

function createAccountDeletionRouter({ accountDeletionService, authClient }) {
  const router = express.Router();

  // Mounted behind the existing requireAuth middleware in app.js.
  router.delete("/account", async (req, res, next) => {
    if (!req.user?.uid) {
      return res.status(401).json({
        error: "Authentication is required.",
        code: "auth-required",
      });
    }

    if (req.body?.confirmation !== "DELETE") {
      return res.status(400).json({
        error: "Type DELETE to confirm account deletion.",
        code: "deletion-not-confirmed",
      });
    }

    if (!accountDeletionService || !authClient) {
      return res.status(503).json({
        error: "Account deletion is unavailable.",
        code: "deletion-unavailable",
      });
    }

    const authorization = req.get("Authorization") || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return res.status(401).json({
        error: "Authentication is required.",
        code: "auth-token-required",
      });
    }

    let decoded;
    try {
      // Destructive action: recheck revocation, not just token signature.
      decoded = await authClient.verifyIdToken(match[1], true);
    } catch (_error) {
      return res.status(401).json({
        error: "Please sign in again before deleting your account.",
        code: "invalid-auth-token",
      });
    }

    if (decoded.uid !== req.user.uid) {
      return res.status(401).json({
        error: "Account identity does not match.",
        code: "identity-mismatch",
      });
    }

    const authTime = Number(decoded.auth_time);
    const secondsSinceAuthentication =
      Math.floor(Date.now() / 1000) - authTime;

    if (
      !Number.isFinite(authTime) ||
      secondsSinceAuthentication < -60 ||
      secondsSinceAuthentication > 300
    ) {
      return res.status(403).json({
        error: "Verify your identity again before deleting your account.",
        code: "recent-login-required",
      });
    }

    try {
      await accountDeletionService.deleteAccount(req.user.uid);
      return res.status(200).json({ deleted: true });
    } catch (error) {
      if (error.code === "account-deletion-partial") {
        return res.status(500).json({
          error: error.message,
          code: error.code,
        });
      }
      return next(error);
    }
  });

  return router;
}

module.exports = createAccountDeletionRouter;
