
import { auth } from "../config/firebase";

import {
  sendEmailVerification,
  reload,
  signOut,
} from "firebase/auth";

import {
  emailVerificationService,
} from "./emailVerificationService";

jest.mock("../config/firebase", () => ({
  auth: {
    currentUser: null,
  },
}));

jest.mock("firebase/auth", () => ({
  sendEmailVerification: jest.fn(),
  reload: jest.fn(),
  signOut: jest.fn(),
}));

describe("SEC-02 email verification service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    auth.currentUser = null;
  });

  test("requires sign-in before sending verification mail", async () => {
    await expect(
      emailVerificationService.send()
    ).rejects.toThrow(
      /sign in before requesting/i
    );

    expect(
      sendEmailVerification
    ).not.toHaveBeenCalled();
  });

  test("sends through Firebase for the signed-in user", async () => {
    const user = {
      uid: "user-1",
    };

    auth.currentUser = user;

    await emailVerificationService.send();

    expect(
      sendEmailVerification
    ).toHaveBeenCalledWith(user);
  });

  test("reloads the user and refreshes the token before checking verification", async () => {
    const user = {
      emailVerified: true,
      getIdToken: jest.fn(),
    };

    auth.currentUser = user;

    await expect(
      emailVerificationService.check()
    ).resolves.toBe(true);

    expect(reload).toHaveBeenCalledWith(user);

    expect(
      user.getIdToken
    ).toHaveBeenCalledWith(true);
  });

  test("returns false when Firebase still shows an unverified email", async () => {
    auth.currentUser = {
      emailVerified: false,
      getIdToken: jest.fn(),
    };

    await expect(
      emailVerificationService.check()
    ).resolves.toBe(false);
  });

  test("signs out through Firebase authentication", async () => {
    await emailVerificationService.signOut();

    expect(signOut).toHaveBeenCalledWith(auth);
  });
});
