
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  signOut,
} from "firebase/auth";
import { auth } from "../config/firebase";
import { accountDeletionService } from "./accountDeletionService";

jest.mock("../config/firebase", () => ({
  auth: { currentUser: null },
}));

jest.mock("firebase/auth", () => ({
  EmailAuthProvider: {
    credential: jest.fn((email, password) => ({ email, password })),
  },
  GoogleAuthProvider: jest.fn().mockImplementation(() => ({ providerId: "google.com" })),
  reauthenticateWithCredential: jest.fn(),
  reauthenticateWithPopup: jest.fn(),
  signOut: jest.fn(),
}));

function firebaseUser(providers = ["password"]) {
  return {
    uid: "u1",
    email: "test@example.com",
    providerData: providers.map((providerId) => ({ providerId })),
    getIdToken: jest.fn().mockResolvedValue("fresh-token"),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  auth.currentUser = firebaseUser();
  reauthenticateWithCredential.mockResolvedValue({});
  reauthenticateWithPopup.mockResolvedValue({});
  signOut.mockResolvedValue({});
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ deleted: true }),
  });
});

test("reauthenticates, sends a fresh token, then signs out", async () => {
  await expect(accountDeletionService.deleteAccount({
    confirmation: "DELETE", method: "password", password: "secret",
  })).resolves.toEqual({ deleted: true });
  expect(EmailAuthProvider.credential).toHaveBeenCalledWith("test@example.com", "secret");
  expect(reauthenticateWithCredential).toHaveBeenCalled();
  expect(auth.currentUser.getIdToken).toHaveBeenCalledWith(true);
  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining("/users/account"),
    expect.objectContaining({
      method: "DELETE",
      headers: expect.objectContaining({ Authorization: "Bearer fresh-token" }),
      body: JSON.stringify({ confirmation: "DELETE" }),
    })
  );
  expect(signOut).toHaveBeenCalledWith(auth);
});

test("Google verification works only when linked", async () => {
  auth.currentUser = firebaseUser(["google.com"]);
  await accountDeletionService.deleteAccount({
    confirmation: "DELETE", method: "google",
  });
  expect(reauthenticateWithPopup).toHaveBeenCalled();
  expect(reauthenticateWithCredential).not.toHaveBeenCalled();
});

test("rejects incorrect confirmation before Firebase or network", async () => {
  await expect(accountDeletionService.deleteAccount({
    confirmation: "delete", method: "password", password: "secret",
  })).rejects.toThrow("Type DELETE");
  expect(global.fetch).not.toHaveBeenCalled();
});

test("rejects wrong current password without sending DELETE", async () => {
  reauthenticateWithCredential.mockRejectedValue({ code: "auth/invalid-credential" });
  await expect(accountDeletionService.deleteAccount({
    confirmation: "DELETE", method: "password", password: "wrong",
  })).rejects.toThrow("Current password is incorrect.");
  expect(global.fetch).not.toHaveBeenCalled();
  expect(signOut).not.toHaveBeenCalled();
});

test("does not sign out after a backend deletion failure", async () => {
  global.fetch.mockResolvedValue({
    ok: false,
    json: async () => ({ error: "Recent verification required", code: "recent-login-required" }),
  });
  await expect(accountDeletionService.deleteAccount({
    confirmation: "DELETE", method: "password", password: "secret",
  })).rejects.toMatchObject({ code: "recent-login-required" });
  expect(signOut).not.toHaveBeenCalled();
});
