// /src/services/userService.js

import { auth } from "../config/firebase";

const API_BASE_URL = (
  process.env.REACT_APP_API_BASE_URL ||
  "http://localhost:5001/api"
).replace(/\/$/, "");

async function getIdToken() {
  const user = auth.currentUser;

  if (!user) {
    throw new Error(
      "Authenticated Firebase user is required."
    );
  }

  return user.getIdToken();
}

async function parseResponse(response) {
  let payload = null;

  try {
    payload = await response.json();
  } catch {
    // Use fallback error below.
  }

  if (!response.ok) {
    const error = new Error(
      payload?.error ||
        "User profile request failed."
    );

    error.code =
      payload?.code ||
      "profile-request-failed";

    throw error;
  }

  return payload;
}

export const userService = {
  async getProfile() {
    const idToken = await getIdToken();

    const response = await fetch(
      `${API_BASE_URL}/users/profile`,
      {
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      }
    );

    const payload = await parseResponse(response);

    return payload?.profile || null;
  },

  async updateProfile(updates) {
    const idToken = await getIdToken();

    const response = await fetch(
      `${API_BASE_URL}/users/profile`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(updates),
      }
    );

    const payload = await parseResponse(response);

    return payload?.profile || null;
  },
};