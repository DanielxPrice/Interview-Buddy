
function getCurrentUser() {
  const { auth } = require("../config/firebase");

  return auth.currentUser;
}

export const emailVerificationService = {
  async send() {
    const user = getCurrentUser();

    if (!user) {
      throw new Error(
        "Sign in before requesting a verification email."
      );
    }

    const {
      sendEmailVerification,
    } = require("firebase/auth");

    await sendEmailVerification(user);
  },

  async check() {
    const user = getCurrentUser();

    if (!user) {
      throw new Error(
        "Your session has ended. Please sign in again."
      );
    }

    const {
      reload,
    } = require("firebase/auth");

    await reload(user);

    // Force Firebase to issue a token containing
    // the current email-verification status.
    await user.getIdToken(true);

    return user.emailVerified === true;
  },

  async signOut() {
    const {
      auth,
    } = require("../config/firebase");

    const {
      signOut,
    } = require("firebase/auth");

    await signOut(auth);
  },
};
