
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  signOut,
} from "firebase/auth";

import { auth } from "../config/firebase";

const API_BASE_URL = (
  process.env.REACT_APP_API_BASE_URL || "http://localhost:5001/api"
).replace(/\/$/, "");

function hasProvider(user, providerId) {
  return user?.providerData?.some(
    (provider) => provider?.providerId === providerId
  ) === true;
}

export const accountDeletionService = {
  async deleteAccount({ confirmation, method, password = "" }) {
    if (confirmation !== "DELETE") {
      throw new Error("Type DELETE to confirm account deletion.");
    }

    const user = auth.currentUser;
    if (!user) {
      throw new Error("Please sign in before deleting your account.");
    }
    const originalUid = user.uid;

    try {
      if (method === "password") {
        if (!user.email || !hasProvider(user, "password")) {
          throw new Error("Password sign-in is not linked to this account.");
        }
        if (!password) {
          throw new Error("Enter your current password.");
        }
        await reauthenticateWithCredential(
          user,
          EmailAuthProvider.credential(user.email, password)
        );
      } else if (method === "google") {
        if (!hasProvider(user, "google.com")) {
          throw new Error("Google sign-in is not linked to this account.");
        }
        await reauthenticateWithPopup(user, new GoogleAuthProvider());
      } else {
        throw new Error("Select a supported verification method.");
      }
    } catch (error) {
      const messages = {
        "auth/invalid-credential": "Current password is incorrect.",
        "auth/wrong-password": "Current password is incorrect.",
        "auth/too-many-requests": "Too many attempts. Try again later.",
        "auth/popup-closed-by-user": "Google verification was canceled.",
        "auth/cancelled-popup-request": "Google verification was canceled.",
        "auth/user-mismatch": "The Google account does not match this account.",
        "auth/network-request-failed": "Unable to reach Firebase. Try again.",
      };
      const failure = new Error(messages[error?.code] || error?.message ||
        "Identity verification failed.");
      failure.code = error?.code || "reauthentication-failed";
      throw failure;
    }

    if (!auth.currentUser || auth.currentUser.uid !== originalUid) {
      throw new Error("The signed-in account changed during verification.");
    }

    // Force-refresh the token so the backend receives the recent auth_time.
    const token = await auth.currentUser.getIdToken(true);
    const response = await fetch(`${API_BASE_URL}/users/account`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ confirmation: "DELETE" }),
    });

    let payload;
    try {
      payload = await response.json();
    } catch (_error) {
      payload = null;
    }

    if (!response.ok || payload?.deleted !== true) {
      const failure = new Error(
        payload?.error || "Account deletion could not be completed."
      );
      failure.code = payload?.code || "account-deletion-failed";
      throw failure;
    }

    // Admin SDK deleted the identity. Clear the browser session afterward.
    try {
      await signOut(auth);
    } catch (_error) {
      const failure = new Error(
        "Account deleted, but this browser could not clear the local session. Close the application."
      );
      failure.code = "account-deleted-signout-failed";
      throw failure;
    }

    return { deleted: true };
  },
};
