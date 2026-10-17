const { admin } = require("../firebaseAdmin");
const {
  normalizeUserRole,
} = require("../config/roles");

async function requireAuth(req, res, next) {
  const authorizationHeader =
    req.get("Authorization") || "";

  const match = authorizationHeader.match(
    /^Bearer\s+(.+)$/i
  );

  if (!match) {
    return res.status(401).json({
      error: "Authentication is required.",
      code: "auth-token-required",
    });
  }

  const idToken = match[1];

  try {
    const decodedToken =
      await admin.auth().verifyIdToken(idToken);

    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email || "",
      emailVerified:
        decodedToken.email_verified === true,
      role: normalizeUserRole(
        decodedToken.role
      ),
    };

    return next();
  } catch (error) {
    return res.status(401).json({
      error:
        "The authentication token is invalid or expired.",
      code: "invalid-auth-token",
    });
  }
}

module.exports = requireAuth;