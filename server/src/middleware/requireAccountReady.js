
function createRequireAccountReady({ userRepository }) {
  return async function requireAccountReady(
    req,
    res,
    next
  ) {
    if (!req.user?.uid) {
      return res.status(401).json({
        code: "auth-token-required",
        error: "Authentication is required.",
      });
    }

    // Allow a signed-in account to create or
    // retrieve its initial application profile.
    // Also allow account deletion before onboarding
    // is complete.
    const isUsersApi =
      req.baseUrl === "/api/users";

    const isProfileBootstrap =
      isUsersApi &&
      req.path === "/profile" &&
      (
        req.method === "GET" ||
        req.method === "POST"
      );

    const isAccountDeletion =
      isUsersApi &&
      req.path === "/account" &&
      req.method === "DELETE";

    if (
      isProfileBootstrap ||
      isAccountDeletion
    ) {
      return next();
    }

    try {
      if (
        typeof userRepository?.findById !==
        "function"
      ) {
        throw new Error(
          "User repository is unavailable."
        );
      }

      const profile =
        await userRepository.findById(
          req.user.uid
        );

      // A profile must exist and belong to
      // the same Firebase-authenticated UID.
      if (
        !profile ||
        profile.uid !== req.user.uid
      ) {
        return res.status(403).json({
          code: "account-profile-required",
          error:
            "Complete your account setup before using this feature.",
        });
      }

      // Support a deletion state when account
      // lifecycle hardening is implemented.
      if (
        profile.deleting === true ||
        profile.status === "deleting"
      ) {
        return res.status(403).json({
          code: "account-deletion-in-progress",
          error: "This account is being deleted.",
        });
      }

      // Protect practice features from accounts
      // without a verified email address.
      if (
        !req.user.email ||
        !req.user.emailVerified
      ) {
        return res.status(403).json({
          code: "email-verification-required",
          error:
            "Verify your email address before using this feature.",
        });
      }

      req.accountProfile = profile;

      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = createRequireAccountReady;
