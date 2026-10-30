import {
  EmailAuthProvider,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  deleteUser,
  linkWithCredential,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
  updateProfile,
} from "firebase/auth";

import { auth } from "../config/firebase";

const API_BASE_URL = (
  process.env.REACT_APP_API_BASE_URL || "http://localhost:5001/api"
).replace(/\/$/, "");

let pendingGoogleUser = null;
let pendingGoogleCredential = null;
let pendingGoogleEmail = "";
let pendingGoogleUsername = "";
let pendingGoogleUsesGeneratedUsername = false;

function getProviderIds(user) {
  if (!Array.isArray(user?.providerData)) {
    return [];
  }

  return [
    ...new Set(
      user.providerData.map((provider) => provider?.providerId).filter(Boolean),
    ),
  ];
}

function hasProvider(user, providerId) {
  return getProviderIds(user).includes(providerId);
}

function mapFirebaseUser(user) {
  if (!user) {
    return null;
  }

  return {
    uid: user.uid,
    email: user.email,
    username: user.displayName || "",
    emailVerified: user.emailVerified,
    providerIds: getProviderIds(user),
  };
}

function clearPendingGoogleState() {
  pendingGoogleUser = null;
  pendingGoogleCredential = null;
  pendingGoogleEmail = "";
  pendingGoogleUsername = "";
  pendingGoogleUsesGeneratedUsername = false;
}

async function createUserProfile(user, username) {
  const idToken = await user.getIdToken();

  const response = await fetch(`${API_BASE_URL}/users/profile`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      username,
    }),
  });

  let payload = null;

  try {
    payload = await response.json();
  } catch {
    // Leave payload null so the fallback error can be used.
  }

  if (!response.ok) {
    const error = new Error(
      payload?.error || "User profile could not be created.",
    );

    error.code = payload?.code || "profile-creation-failed";

    throw error;
  }

  return payload?.profile || null;
}

async function getUserProfile(user) {
  if (!user) {
    throw new Error("An authenticated user is required.");
  }

  const idToken = await user.getIdToken();

  const response = await fetch(`${API_BASE_URL}/users/profile`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });

  let payload = null;

  try {
    payload = await response.json();
  } catch {
    // Leave payload null so a fallback error can be used.
  }

  if (response.status === 404 && payload?.code === "profile-not-found") {
    return null;
  }

  if (!response.ok) {
    const error = new Error(
      payload?.error || "User profile could not be loaded.",
    );

    error.code = payload?.code || "profile-load-failed";

    throw error;
  }

  return payload?.profile || null;
}

function getGeneratedUsernameCandidates(user) {
  const uid = String(user?.uid || "")
    .trim()
    .toLowerCase();

  const emailPrefix = String(user?.email || "")
    .split("@")[0]
    .trim()
    .toLowerCase();

  const cleanedBase =
    emailPrefix.replace(/[^a-z0-9_-]/g, "").slice(0, 20) || "user";

  const shortUid = uid.slice(0, 6) || "account";

  const longerUid = uid.slice(0, 8) || "account";

  return [
    `${cleanedBase}_${shortUid}`,
    `${cleanedBase}_${longerUid}`,
    `user_${longerUid}`,
  ];
}

async function rollbackRegistration(user) {
  try {
    await deleteUser(user);
    return true;
  } catch {
    return false;
  }
}

function createLoginError(error) {
  const messages = {
    "auth/invalid-credential": "Invalid email or password.",
    "auth/user-not-found": "Invalid email or password.",
    "auth/wrong-password": "Invalid email or password.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/user-disabled": "This account has been disabled.",
    "auth/too-many-requests":
      "Too many login attempts. Please try again later.",
    "auth/network-request-failed":
      "Unable to reach the authentication service. Please try again.",
    "auth/popup-closed-by-user": "Google sign-in was canceled.",
    "auth/cancelled-popup-request": "Google sign-in was canceled.",
  };

  const loginError = new Error(
    messages[error?.code] || "Login failed. Please try again.",
  );

  loginError.code = error?.code || "auth/login-failed";

  return loginError;
}

function createRegistrationError(error) {
  const messages = {
    "auth/email-already-in-use": "An account with this email already exists.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/weak-password": "Password does not meet the required strength.",
    "auth/network-request-failed":
      "Unable to reach the authentication service. Please try again.",
    "auth/too-many-requests":
      "Too many registration attempts. Please try again later.",
  };

  const registrationError = new Error(
    messages[error?.code] || "Account creation failed. Please try again.",
  );

  registrationError.code = error?.code || "auth/registration-failed";

  return registrationError;
}

function createGoogleSetupError(error) {
  const messages = {
    "auth/weak-password": "Password does not meet the required strength.",
    "auth/email-already-in-use":
      "That email is already attached to another account.",
    "auth/credential-already-in-use":
      "That sign-in method is already attached to another account.",
    "auth/requires-recent-login":
      "Please sign in again before changing your sign-in methods.",
    "auth/invalid-credential":
      "The sign-in credential is no longer valid. Please try again.",
    "auth/too-many-requests": "Too many attempts. Please try again later.",
    "auth/network-request-failed":
      "Unable to reach Firebase. Please try again.",
  };

  const setupError = new Error(
    messages[error?.code] ||
      "Account setup could not be completed. Please try again.",
  );

  setupError.code = error?.code || "auth/google-setup-failed";

  return setupError;
}

function validateNewPassword(password, confirmPassword) {
  if (!password || !confirmPassword) {
    const error = new Error("Password and confirmation are required.");

    error.code = "password-required";

    throw error;
  }

  if (password !== confirmPassword) {
    const error = new Error("Passwords do not match.");

    error.code = "password-mismatch";

    throw error;
  }

  if (password.length < 6) {
    const error = new Error("Password must be at least 6 characters.");

    error.code = "password-too-short";

    throw error;
  }
}

async function linkPasswordToUser(user, password, confirmPassword) {
  if (hasProvider(user, EmailAuthProvider.PROVIDER_ID)) {
    return user;
  }

  validateNewPassword(password, confirmPassword);

  const email = String(user?.email || "").trim();

  if (!email) {
    const error = new Error(
      "A verified email address is required to create a password.",
    );

    error.code = "auth/google-email-missing";

    throw error;
  }

  const credential = EmailAuthProvider.credential(email, password);

  try {
    const result = await linkWithCredential(user, credential);

    return result.user;
  } catch (error) {
    if (error?.code === "auth/provider-already-linked") {
      return user;
    }

    throw createGoogleSetupError(error);
  }
}

async function createPreparedGoogleProfile(user) {
  if (!pendingGoogleUsername) {
    const error = new Error(
      "Please choose a username before creating your password.",
    );

    error.code = "username-required";

    throw error;
  }

  if (!pendingGoogleUsesGeneratedUsername) {
    return createUserProfile(user, pendingGoogleUsername);
  }

  const candidates = getGeneratedUsernameCandidates(user);

  let lastError = null;

  for (const username of candidates) {
    try {
      pendingGoogleUsername = username;

      return await createUserProfile(user, username);
    } catch (error) {
      lastError = error;

      if (error.code === "username-already-exists") {
        continue;
      }

      throw error;
    }
  }

  const error = new Error(
    "A unique username could not be generated. Please choose a username.",
  );

  error.code = "generated-username-unavailable";

  error.cause = lastError;

  throw error;
}

export const authService = {
  async login(credentials) {
    if (!credentials) {
      throw new Error("Login credentials are required.");
    }

    const { email, password } = credentials;

    const normalizedEmail = email?.trim();

    if (!normalizedEmail || !password) {
      throw new Error("Email and password are required.");
    }

    let userCredential;

    try {
      userCredential = await signInWithEmailAndPassword(
        auth,
        normalizedEmail,
        password,
      );
    } catch (error) {
      throw createLoginError(error);
    }

    return {
      authenticated: true,
      user: mapFirebaseUser(userCredential.user),
    };
  },

  async register(userData) {
    if (!userData) {
      throw new Error("Registration data is required.");
    }

    const { username, email, password } = userData;

    const normalizedUsername = username?.trim();

    const normalizedEmail = email?.trim();

    if (!normalizedUsername || !normalizedEmail || !password) {
      throw new Error("Username, email, and password are required.");
    }

    let userCredential;

    try {
      userCredential = await createUserWithEmailAndPassword(
        auth,
        normalizedEmail,
        password,
      );
    } catch (error) {
      throw createRegistrationError(error);
    }

    try {
      await updateProfile(userCredential.user, {
        displayName: normalizedUsername,
      });
    } catch (error) {
      const rolledBack = await rollbackRegistration(userCredential.user);

      if (!rolledBack) {
        const rollbackError = new Error(
          "Registration could not be completed, and the partially created account could not be removed. Please contact support or try signing in.",
        );

        rollbackError.code = "auth/registration-rollback-failed";

        throw rollbackError;
      }

      const profileError = new Error(
        "Registration could not be completed because the username could not be saved. Please try again.",
      );

      profileError.code = "auth/profile-setup-failed";

      throw profileError;
    }

    try {
      await createUserProfile(userCredential.user, normalizedUsername);
    } catch (error) {
      const rolledBack = await rollbackRegistration(userCredential.user);

      if (!rolledBack) {
        const rollbackError = new Error(
          "Registration could not be completed, and the partially created account could not be removed. Please contact support or try signing in.",
        );

        rollbackError.code = "auth/registration-rollback-failed";

        throw rollbackError;
      }

      throw error;
    }

    const registeredUser = mapFirebaseUser(userCredential.user);

    try {
      await signOut(auth);
    } catch (error) {
      const signOutError = new Error(
        "Your account was created, but automatic sign-out failed. Please sign out before continuing.",
      );

      signOutError.code = "auth/post-registration-signout-failed";

      throw signOutError;
    }

    return {
      created: true,
      user: registeredUser,
    };
  },

  async loginWithGoogle() {
    clearPendingGoogleState();

    const provider = new GoogleAuthProvider();

    let userCredential;

    try {
      userCredential = await signInWithPopup(auth, provider);
    } catch (error) {
      if (error?.code === "auth/account-exists-with-different-credential") {
        const googleCredential =
          GoogleAuthProvider.credentialFromError?.(error) ||
          error?.credential ||
          null;

        const conflictEmail = String(
          error?.customData?.email || error?.email || "",
        ).trim();

        if (googleCredential && conflictEmail) {
          pendingGoogleCredential = googleCredential;

          pendingGoogleEmail = conflictEmail;

          return {
            authenticated: false,
            needsExistingPasswordToLinkGoogle: true,
            email: conflictEmail,
          };
        }
      }

      throw createLoginError(error);
    }

    const firebaseUser = userCredential.user;

    pendingGoogleUser = firebaseUser;

    const profile = await getUserProfile(firebaseUser);

    const passwordLinked = hasProvider(
      firebaseUser,
      EmailAuthProvider.PROVIDER_ID,
    );

    if (profile && passwordLinked) {
      clearPendingGoogleState();

      return {
        authenticated: true,
        needsUsernameSetup: false,
        needsPasswordSetup: false,
        user: {
          ...mapFirebaseUser(firebaseUser),
          username: profile.username || firebaseUser.displayName || "",
        },
        profile,
      };
    }

    if (profile && !passwordLinked) {
      return {
        authenticated: true,
        needsUsernameSetup: false,
        needsPasswordSetup: true,
        existingProfile: true,
        user: {
          ...mapFirebaseUser(firebaseUser),
          username: profile.username || firebaseUser.displayName || "",
        },
        profile,
      };
    }

    return {
      authenticated: true,
      needsUsernameSetup: true,
      needsPasswordSetup: true,
      existingProfile: false,
      user: mapFirebaseUser(firebaseUser),
    };
  },

  async prepareGoogleUsername(username) {
    const user = pendingGoogleUser || auth.currentUser;

    if (!user) {
      const error = new Error(
        "No Google account is waiting for profile setup.",
      );

      error.code = "auth/google-profile-user-missing";

      throw error;
    }

    const normalizedUsername = String(username || "").trim();

    if (!normalizedUsername) {
      const error = new Error("Please enter a username.");

      error.code = "username-required";

      throw error;
    }

    pendingGoogleUser = user;

    pendingGoogleUsername = normalizedUsername;

    pendingGoogleUsesGeneratedUsername = false;

    return {
      needsPasswordSetup: true,
      username: normalizedUsername,
    };
  },

  async prepareGeneratedGoogleUsername() {
    const user = pendingGoogleUser || auth.currentUser;

    if (!user) {
      const error = new Error(
        "No Google account is waiting for profile setup.",
      );

      error.code = "auth/google-profile-user-missing";

      throw error;
    }

    const [firstCandidate] = getGeneratedUsernameCandidates(user);

    pendingGoogleUser = user;

    pendingGoogleUsername = firstCandidate;

    pendingGoogleUsesGeneratedUsername = true;

    return {
      needsPasswordSetup: true,
      username: firstCandidate,
      generatedUsername: firstCandidate,
    };
  },

  async completeGoogleRegistration({ password, confirmPassword } = {}) {
    let user = pendingGoogleUser || auth.currentUser;

    if (!user) {
      const error = new Error(
        "No Google account is waiting for account setup.",
      );

      error.code = "auth/google-profile-user-missing";

      throw error;
    }

    if (!pendingGoogleUsername) {
      const error = new Error(
        "Please choose a username before creating your password.",
      );

      error.code = "username-required";

      throw error;
    }

    user = await linkPasswordToUser(user, password, confirmPassword);

    pendingGoogleUser = user;

    try {
      await updateProfile(user, {
        displayName: pendingGoogleUsername,
      });
    } catch {
      // Firestore remains the Interview Buddy
      // source of truth for the username.
    }

    let profile;

    try {
      profile = await createPreparedGoogleProfile(user);
    } catch (error) {
      // Keep the Firebase user signed in so the
      // user can correct a username collision.
      throw error;
    }

    const completedUser = {
      ...mapFirebaseUser(user),
      username: profile?.username || pendingGoogleUsername,
    };

    const generatedUsername = pendingGoogleUsesGeneratedUsername
      ? profile?.username || pendingGoogleUsername
      : undefined;

    clearPendingGoogleState();

    return {
      authenticated: true,
      needsUsernameSetup: false,
      needsPasswordSetup: false,
      generatedUsername,
      profile,
      user: completedUser,
    };
  },

  async completeGooglePasswordSetup({ password, confirmPassword } = {}) {
    let user = pendingGoogleUser || auth.currentUser;

    if (!user) {
      const error = new Error(
        "No Google account is waiting for password setup.",
      );

      error.code = "auth/google-profile-user-missing";

      throw error;
    }

    user = await linkPasswordToUser(user, password, confirmPassword);

    const profile = await getUserProfile(user);

    if (!profile) {
      const error = new Error(
        "Your Interview Buddy profile could not be found.",
      );

      error.code = "profile-not-found";

      throw error;
    }

    const completedUser = {
      ...mapFirebaseUser(user),
      username: profile.username || user.displayName || "",
    };

    clearPendingGoogleState();

    return {
      authenticated: true,
      needsPasswordSetup: false,
      profile,
      user: completedUser,
    };
  },

  async completeExistingPasswordGoogleLink(password) {
    if (!pendingGoogleCredential || !pendingGoogleEmail) {
      const error = new Error(
        "There is no Google sign-in waiting to be linked.",
      );

      error.code = "auth/google-link-missing";

      throw error;
    }

    if (!password) {
      const error = new Error("Please enter your existing password.");

      error.code = "password-required";

      throw error;
    }

    let userCredential;

    try {
      userCredential = await signInWithEmailAndPassword(
        auth,
        pendingGoogleEmail,
        password,
      );
    } catch (error) {
      throw createLoginError(error);
    }

    let linkedUser = userCredential.user;

    try {
      const linkResult = await linkWithCredential(
        linkedUser,
        pendingGoogleCredential,
      );

      linkedUser = linkResult.user;
    } catch (error) {
      if (error?.code !== "auth/provider-already-linked") {
        throw createGoogleSetupError(error);
      }
    }

    const profile = await getUserProfile(linkedUser);

    if (!profile) {
      pendingGoogleUser = linkedUser;

      pendingGoogleCredential = null;

      pendingGoogleEmail = "";

      return {
        authenticated: true,
        needsUsernameSetup: true,
        needsPasswordSetup: false,
        user: mapFirebaseUser(linkedUser),
      };
    }

    const completedUser = {
      ...mapFirebaseUser(linkedUser),
      username: profile.username || linkedUser.displayName || "",
    };

    clearPendingGoogleState();

    return {
      authenticated: true,
      needsUsernameSetup: false,
      needsPasswordSetup: false,
      profile,
      user: completedUser,
    };
  },

  async cancelGoogleSetup() {
    const user = pendingGoogleUser || auth.currentUser;

    if (!user) {
      clearPendingGoogleState();

      return {
        canceled: true,
        deletedIncompleteAccount: false,
      };
    }

    let profile;

    try {
      profile = await getUserProfile(user);
    } catch (error) {
      const cancelError = new Error(
        "Account setup could not be canceled because the account state could not be verified. Please try again.",
      );

      cancelError.code = "auth/google-cancel-verification-failed";

      throw cancelError;
    }

    if (!profile) {
      try {
        await deleteUser(user);
      } catch (error) {
        const cancelError = new Error(
          "The incomplete account could not be removed. Please try again.",
        );

        cancelError.code = error?.code || "auth/google-cancel-delete-failed";

        throw cancelError;
      }

      clearPendingGoogleState();

      return {
        canceled: true,
        deletedIncompleteAccount: true,
      };
    }

    try {
      await signOut(auth);
    } catch (error) {
      const cancelError = new Error("Sign out failed. Please try again.");

      cancelError.code = error?.code || "auth/logout-failed";

      throw cancelError;
    }

    clearPendingGoogleState();

    return {
      canceled: true,
      deletedIncompleteAccount: false,
    };
  },

  async logout() {
    try {
      await signOut(auth);
    } catch (error) {
      const logoutError = new Error("Logout failed. Please try again.");

      logoutError.code = error?.code || "auth/logout-failed";

      throw logoutError;
    }

    clearPendingGoogleState();

    return {
      success: true,
    };
  },

  getCurrentUser() {
    return mapFirebaseUser(auth.currentUser);
  },

  async getCurrentUserProfile() {
    const user = auth.currentUser;

    if (!user) {
      return null;
    }

    return getUserProfile(user);
  },

  subscribeToAuthState(callback) {
    if (typeof callback !== "function") {
      throw new Error("Auth state callback is required.");
    }

    return onAuthStateChanged(auth, (user) => {
      callback(mapFirebaseUser(user));
    });
  },

  async changePassword(currentPassword, newPassword) {
    if (!currentPassword || !newPassword) {
      throw new Error("Current and new passwords are required.");
    }

    if (newPassword.length < 6) {
      throw new Error("New password must be at least 6 characters long.");
    }

    if (currentPassword === newPassword) {
      throw new Error(
        "New password cannot be the same as the current password.",
      );
    }

    const user = auth.currentUser;

    if (!user) {
      throw new Error("Please sign in before changing your password.");
    }

    if (!user.email || !hasProvider(user, EmailAuthProvider.PROVIDER_ID)) {
      throw new Error(
        "This account does not have an email/password sign-in method. " +
          "Password changes are only supported for accounts with a linked password.",
      );
    }

    try {
      const credential = EmailAuthProvider.credential(
        user.email,
        currentPassword,
      );

      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPassword);

      return { success: true };
    } catch (error) {
      const messages = {
        "auth/invalid-credential": "Current password is incorrect.",
        "auth/wrong-password": "Current password is incorrect.",
        "auth/user-mismatch": "The credentials do not match this account.",
        "auth/weak-password":
          "New password does not meet the password requirements.",
        "auth/too-many-requests": "Too many attempts. Please try again later.",
        "auth/network-request-failed":
          "Unable to reach Firebase. Please try again.",
        "auth/requires-recent-login": "Please sign in again and retry.",
        "auth/multi-factor-auth-required":
          "Additional authentication is required before changing your password.",
      };

      const passwordError = new Error(
        messages[error?.code] || "Unable to change password. Please try again.",
      );

      passwordError.code = error?.code || "auth/password-change-failed";

      throw passwordError;
    }
  },

  async resetPassword(email) {
    const normalizedEmail = email?.trim();

    if (!normalizedEmail) {
      throw new Error("Email is required.");
    }

    try {
      await sendPasswordResetEmail(auth, normalizedEmail);
    } catch (error) {
      const messages = {
        "auth/invalid-email": "Please enter a valid email address.",
        "auth/user-not-found": "No account was found with that email.",
        "auth/too-many-requests": "Too many requests. Please try again later.",
        "auth/network-request-failed":
          "Unable to reach Firebase. Please try again.",
      };

      const resetError = new Error(
        messages[error?.code] || "Password reset email could not be sent.",
      );

      resetError.code = error?.code || "auth/reset-failed";

      throw resetError;
    }

    return {
      success: true,
    };
  },
};
