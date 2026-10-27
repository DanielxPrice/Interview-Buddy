
const { admin } = require("../firebaseAdmin");
const { normalizeUserRole } = require("../config/roles");

async function requireAuth(req, res, next) {
  const authorizationHeader = req.get("Authorization") || "";

  const match = authorizationHeader.match(
    /^Bearer\s+(\S+)$/i
  );

  if (!match) {
    return res.status(401).json({
      error: "Authentication is required.",
      code: "auth-token-required",
    });
  }

  try {
    const auth = admin.auth();

    // Verify the token and check current Firebase
    // revocation and account-disabled status.
    const decoded = await auth.verifyIdToken(
      match[1],
      true
    );

    if (
      typeof decoded.uid !== "string" ||
      !decoded.uid
    ) {
      return res.status(401).json({
        error:
          "The authentication token is invalid or expired.",
        code: "invalid-auth-token",
      });
    }

    let role = normalizeUserRole(decoded.role);

    // An old token may still contain an admin claim
    // after an administrative role downgrade.
    // Check the current Firebase user record before
    // granting admin permissions.
    if (role === "admin") {
      const currentUser = await auth.getUser(
        decoded.uid
      );

      role = normalizeUserRole(
        currentUser.customClaims?.role
      );
    }

    req.user = {
      uid: decoded.uid,
      email: decoded.email || "",
      emailVerified:
        decoded.email_verified === true,
      role,
    };

    return next();
  } catch (error) {
    // Fail closed when Firebase verification is
    // unavailable rather than allowing access.
    const unavailable = [
      "auth/internal-error",
      "auth/network-request-failed",
      "auth/insufficient-permission",
    ].includes(error?.code);

    return res.status(
      unavailable ? 503 : 401
    ).json({
      error: unavailable
        ? "Authentication verification is temporarily unavailable."
        : "The authentication token is invalid or expired.",
      code: unavailable
        ? "auth-verification-unavailable"
        : "invalid-auth-token",
    });
  }
}

module.exports = requireAuth;
