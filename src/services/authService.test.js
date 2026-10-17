import {
  EmailAuthProvider,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  deleteUser,
  linkWithCredential,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  reauthenticateWithCredential,
  updatePassword,
} from "firebase/auth";

import {
  auth,
} from "../config/firebase";

import {
  authService,
} from "./authService";

global.fetch =
  jest.fn();

jest.mock(
  "firebase/auth",
  () => {
    const GoogleAuthProvider =
      jest.fn(() => ({
        providerId:
          "google.com",
      }));

    GoogleAuthProvider.PROVIDER_ID =
      "google.com";

    GoogleAuthProvider.credentialFromError =
      jest.fn();

    const EmailAuthProvider = {
      PROVIDER_ID:
        "password",

      credential:
        jest.fn(
          (
            email,
            password
          ) => ({
            providerId:
              "password",
            email,
            password,
          })
        ),
    };

    return {
      EmailAuthProvider,
      GoogleAuthProvider,

      createUserWithEmailAndPassword:
        jest.fn(),

      deleteUser:
        jest.fn(),

      linkWithCredential:
        jest.fn(),

      onAuthStateChanged:
        jest.fn(),

       reauthenticateWithCredential: 
        jest.fn(),

      updatePassword: 
        jest.fn(),

      sendPasswordResetEmail:
        jest.fn(),

      signInWithEmailAndPassword:
        jest.fn(),

      signInWithPopup:
        jest.fn(),

      signOut:
        jest.fn(),

      updateProfile:
        jest.fn(),
    };
  }
);

jest.mock(
  "../config/firebase",
  () => ({
    auth: {
      currentUser:
        null,
    },
  })
);

function makeUser({
  uid = "user-123",
  email =
    "test@example.com",
  displayName =
    "TestUser",
  emailVerified = true,
  providerIds = [
    "password",
  ],
} = {}) {
  return {
    uid,
    email,
    displayName,
    emailVerified,

    providerData:
      providerIds.map(
        (providerId) => ({
          providerId,
        })
      ),

    getIdToken:
      jest
        .fn()
        .mockResolvedValue(
          "test-id-token"
        ),
  };
}

function makeProfile({
  uid = "user-123",
  email =
    "test@example.com",
  username =
    "TestUser",
} = {}) {
  return {
    uid,
    username,

    usernameLower:
      username.toLowerCase(),

    email,
    role: "user",

    settings: {
      theme: "light",
    },
  };
}

function mockProfileFound(
  profile =
    makeProfile()
) {
  global.fetch
    .mockResolvedValueOnce({
      ok: true,
      status: 200,

      json: async () => ({
        profile,
      }),
    });
}

function mockProfileMissing() {
  global.fetch
    .mockResolvedValueOnce({
      ok: false,
      status: 404,

      json: async () => ({
        error:
          "User profile was not found.",

        code:
          "profile-not-found",
      }),
    });
}

describe(
  "authService",
  () => {
    beforeEach(() => {
      jest.clearAllMocks();

      reauthenticateWithCredential.mockResolvedValue({});
      updatePassword.mockResolvedValue();

      auth.currentUser = null;

      global.fetch.mockReset();

      signOut.mockResolvedValue();

      deleteUser.mockResolvedValue();

      EmailAuthProvider.credential.mockImplementation(
        (email, password) => ({
          providerId: "password",
          email,
          password,
        })
      );

      updateProfile.mockImplementation(
        async (user, profile) => {
          user.displayName =
            profile.displayName;
        }
      );

      linkWithCredential.mockImplementation(
        async (user, credential) => {
          const providerId =
            credential?.providerId;

          if (!providerId) {
            throw new Error(
              "Test credential is missing providerId."
            );
          }

          if (
            !Array.isArray(
              user.providerData
            )
          ) {
            user.providerData = [];
          }

          const existingIds =
            user.providerData.map(
              (provider) =>
                provider.providerId
            );

          if (
            !existingIds.includes(
              providerId
            )
          ) {
            user.providerData.push({
              providerId,
            });
          }

          auth.currentUser =
            user;

          return {
            user,
          };
        }
      );
    });

    test(
      "login authenticates with email and password",
      async () => {
        const user =
          makeUser({
            email:
              "daniel@example.com",

            displayName:
              "Daniel",

            providerIds: [
              "password",
            ],
          });

        signInWithEmailAndPassword
          .mockResolvedValue({
            user,
          });

        const result =
          await authService
            .login({
              email:
                "daniel@example.com",

              password:
                "password123",
            });

        expect(
          signInWithEmailAndPassword
        ).toHaveBeenCalledWith(
          expect.anything(),

          "daniel@example.com",

          "password123"
        );

        expect(
          result.user
            .providerIds
        ).toEqual([
          "password",
        ]);
      }
    );

    test(
      "login rejects missing credentials",
      async () => {
        await expect(
          authService.login({
            email: "",
            password: "",
          })
        ).rejects.toThrow(
          "Email and password are required."
        );
      }
    );

    test(
      "register creates Firebase user, profile, and signs out",
      async () => {
        const user =
          makeUser({
            displayName:
              null,

            emailVerified:
              false,

            providerIds: [
              "password",
            ],
          });

        createUserWithEmailAndPassword
          .mockResolvedValue({
            user,
          });

        global.fetch
          .mockResolvedValueOnce({
            ok: true,
            status: 201,

            json: async () => ({
              profile:
                makeProfile(),
            }),
          });

        const result =
          await authService
            .register({
              username:
                "TestUser",

              email:
                "test@example.com",

              password:
                "password123",
            });

        expect(
          createUserWithEmailAndPassword
        ).toHaveBeenCalledWith(
          expect.anything(),

          "test@example.com",

          "password123"
        );

        expect(
          global.fetch
        ).toHaveBeenCalledWith(
          "http://localhost:5001/api/users/profile",

          expect.objectContaining({
            method: "POST",

            body:
              JSON.stringify({
                username:
                  "TestUser",
              }),
          })
        );

        expect(
          signOut
        ).toHaveBeenCalled();

        expect(
          result.user
            .providerIds
        ).toContain(
          "password"
        );
      }
    );

    test(
      "register rejects empty username",
      async () => {
        await expect(
          authService.register({
            username: "   ",

            email:
              "test@example.com",

            password:
              "password123",
          })
        ).rejects.toThrow(
          "Username, email, and password are required."
        );

        expect(
          createUserWithEmailAndPassword
        ).not.toHaveBeenCalled();
      }
    );

    test(
      "register rolls back when backend profile creation fails",
      async () => {
        const user =
          makeUser({
            displayName:
              null,
          });

        createUserWithEmailAndPassword
          .mockResolvedValue({
            user,
          });

        global.fetch
          .mockResolvedValueOnce({
            ok: false,
            status: 409,

            json: async () => ({
              error:
                "That username is already in use.",

              code:
                "username-already-exists",
            }),
          });

        await expect(
          authService.register({
            username:
              "TestUser",

            email:
              "test@example.com",

            password:
              "password123",
          })
        ).rejects
          .toMatchObject({
            code:
              "username-already-exists",
          });

        expect(
          deleteUser
        ).toHaveBeenCalledWith(
          user
        );
      }
    );

    test(
      "Google user with profile and both providers signs in directly",
      async () => {
        const user =
          makeUser({
            uid:
              "google-user-123",

            email:
              "daniel@gmail.com",

            displayName:
              "Daniel",

            providerIds: [
              "google.com",
              "password",
            ],
          });

        signInWithPopup
          .mockResolvedValue({
            user,
          });

        mockProfileFound(
          makeProfile({
            uid:
              "google-user-123",

            email:
              "daniel@gmail.com",

            username:
              "Daniel",
          })
        );

        const result =
          await authService
            .loginWithGoogle();

        expect(
          result
            .needsUsernameSetup
        ).toBe(false);

        expect(
          result
            .needsPasswordSetup
        ).toBe(false);

        expect(
          result.user
            .providerIds
        ).toEqual(
          expect.arrayContaining([
            "google.com",
            "password",
          ])
        );
      }
    );

    test(
      "new Google user has no Firestore profile yet",
      async () => {
        const user =
          makeUser({
            uid:
              "google-user-123",

            email:
              "newgoogle@gmail.com",

            providerIds: [
              "google.com",
            ],
          });

        signInWithPopup
          .mockResolvedValue({
            user,
          });

        mockProfileMissing();

        const result =
          await authService
            .loginWithGoogle();

        expect(
          result
            .needsUsernameSetup
        ).toBe(true);

        expect(
          result
            .needsPasswordSetup
        ).toBe(true);

        expect(
          global.fetch
        ).toHaveBeenCalledTimes(
          1
        );

        expect(
          global.fetch
            .mock
            .calls[0][1]
            .method
        ).toBe(
          "GET"
        );
      }
    );

    test(
      "preparing username does not create Firestore profile",
      async () => {
        const user =
          makeUser({
            uid:
              "google-user-123",

            email:
              "newgoogle@gmail.com",

            providerIds: [
              "google.com",
            ],
          });

        signInWithPopup
          .mockResolvedValue({
            user,
          });

        mockProfileMissing();

        await authService
          .loginWithGoogle();

        global.fetch
          .mockClear();

        const result =
          await authService
            .prepareGoogleUsername(
              "InterviewDaniel"
            );

        expect(
          result.username
        ).toBe(
          "InterviewDaniel"
        );

        expect(
          global.fetch
        ).not.toHaveBeenCalled();
      }
    );

    test(
      "new Google registration links password before creating profile",
      async () => {
        const user =
          makeUser({
            uid:
              "google-user-123",

            email:
              "newgoogle@gmail.com",

            providerIds: [
              "google.com",
            ],
          });

        signInWithPopup
          .mockResolvedValue({
            user,
          });

        mockProfileMissing();

        await authService
          .loginWithGoogle();

        await authService
          .prepareGoogleUsername(
            "InterviewDaniel"
          );

        global.fetch
          .mockResolvedValueOnce({
            ok: true,
            status: 201,

            json: async () => ({
              profile:
                makeProfile({
                  uid:
                    "google-user-123",

                  email:
                    "newgoogle@gmail.com",

                  username:
                    "InterviewDaniel",
                }),
            }),
          });

        const result =
          await authService
            .completeGoogleRegistration({
              password:
                "password123",

              confirmPassword:
                "password123",
            });

        expect(
          EmailAuthProvider
            .credential
        ).toHaveBeenCalledWith(
          "newgoogle@gmail.com",

          "password123"
        );

        expect(
          linkWithCredential
        ).toHaveBeenCalled();

        expect(
          global.fetch
        ).toHaveBeenLastCalledWith(
          "http://localhost:5001/api/users/profile",

          expect.objectContaining({
            method:
              "POST",

            body:
              JSON.stringify({
                username:
                  "InterviewDaniel",
              }),
          })
        );

        expect(
          result
            .authenticated
        ).toBe(true);
      }
    );

    test(
      "mismatched Google registration passwords do not link provider",
      async () => {
        const user =
          makeUser({
            uid:
              "google-user-123",

            email:
              "newgoogle@gmail.com",

            providerIds: [
              "google.com",
            ],
          });

        signInWithPopup
          .mockResolvedValue({
            user,
          });

        mockProfileMissing();

        await authService
          .loginWithGoogle();

        await authService
          .prepareGoogleUsername(
            "InterviewDaniel"
          );

        await expect(
          authService
            .completeGoogleRegistration({
              password:
                "password123",

              confirmPassword:
                "different",
            })
        ).rejects
          .toMatchObject({
            code:
              "password-mismatch",
          });

        expect(
          linkWithCredential
        ).not.toHaveBeenCalled();
      }
    );

    test(
      "generated username still waits for password creation",
      async () => {
        const user =
          makeUser({
            uid:
              "F7Q8C5BnLjcvuDJr",

            email:
              "daniel@gmail.com",

            providerIds: [
              "google.com",
            ],
          });

        signInWithPopup
          .mockResolvedValue({
            user,
          });

        mockProfileMissing();

        await authService
          .loginWithGoogle();

        const prepared =
          await authService
            .prepareGeneratedGoogleUsername();

        expect(
          prepared.username
        ).toBe(
          "daniel_f7q8c5"
        );

        expect(
          linkWithCredential
        ).not.toHaveBeenCalled();
      }
    );

    test(
      "existing profile without password requires password setup",
      async () => {
        const user =
          makeUser({
            uid:
              "same-uid-123",

            email:
              "existing@gmail.com",

            displayName:
              "ExistingUser",

            providerIds: [
              "google.com",
            ],
          });

        signInWithPopup
          .mockResolvedValue({
            user,
          });

        mockProfileFound(
          makeProfile({
            uid:
              "same-uid-123",

            email:
              "existing@gmail.com",

            username:
              "ExistingUser",
          })
        );

        const result =
          await authService
            .loginWithGoogle();

        expect(
          result
            .needsPasswordSetup
        ).toBe(true);

        expect(
          result
            .existingProfile
        ).toBe(true);

        expect(
          result.profile.uid
        ).toBe(
          "same-uid-123"
        );
      }
    );

    test(
      "existing Google profile links password and keeps same UID",
      async () => {
        const user =
          makeUser({
            uid:
              "same-uid-123",

            email:
              "existing@gmail.com",

            providerIds: [
              "google.com",
            ],
          });

        signInWithPopup
          .mockResolvedValue({
            user,
          });

        mockProfileFound(
          makeProfile({
            uid:
              "same-uid-123",

            email:
              "existing@gmail.com",
          })
        );

        await authService
          .loginWithGoogle();

        mockProfileFound(
          makeProfile({
            uid:
              "same-uid-123",

            email:
              "existing@gmail.com",
          })
        );

        const result =
          await authService
            .completeGooglePasswordSetup({
              password:
                "password123",

              confirmPassword:
                "password123",
            });

        expect(
          result.profile.uid
        ).toBe(
          "same-uid-123"
        );

        expect(
          result.user
            .providerIds
        ).toEqual(
          expect.arrayContaining([
            "google.com",
            "password",
          ])
        );
      }
    );

    test(
      "different credential conflict asks for existing password",
      async () => {
        const googleCredential = {
          providerId:
            "google.com",
        };

        GoogleAuthProvider
          .credentialFromError
          .mockReturnValue(
            googleCredential
          );

        signInWithPopup
          .mockRejectedValue({
            code:
              "auth/account-exists-with-different-credential",

            customData: {
              email:
                "existing@example.com",
            },
          });

        const result =
          await authService
            .loginWithGoogle();

        expect(
          result
        ).toEqual({
          authenticated:
            false,

          needsExistingPasswordToLinkGoogle:
            true,

          email:
            "existing@example.com",
        });
      }
    );

    test(
      "existing password account links Google to same Firebase user",
      async () => {
        const googleCredential = {
          providerId:
            "google.com",
        };

        GoogleAuthProvider
          .credentialFromError
          .mockReturnValue(
            googleCredential
          );

        signInWithPopup
          .mockRejectedValue({
            code:
              "auth/account-exists-with-different-credential",

            customData: {
              email:
                "existing@example.com",
            },
          });

        await authService
          .loginWithGoogle();

        const existingUser =
          makeUser({
            uid:
              "existing-uid",

            email:
              "existing@example.com",

            providerIds: [
              "password",
            ],
          });

        signInWithEmailAndPassword
          .mockResolvedValue({
            user:
              existingUser,
          });

        mockProfileFound(
          makeProfile({
            uid:
              "existing-uid",

            email:
              "existing@example.com",
          })
        );

        const result =
          await authService
            .completeExistingPasswordGoogleLink(
              "password123"
            );

        expect(
          linkWithCredential
        ).toHaveBeenCalledWith(
          existingUser,
          googleCredential
        );

        expect(
          result.profile.uid
        ).toBe(
          "existing-uid"
        );

        expect(
          result.user
            .providerIds
        ).toEqual(
          expect.arrayContaining([
            "password",
            "google.com",
          ])
        );
      }
    );

    test(
      "cancel incomplete Google account deletes Auth user",
      async () => {
        const user =
          makeUser({
            uid:
              "google-user-123",

            email:
              "newgoogle@gmail.com",

            providerIds: [
              "google.com",
            ],
          });

        signInWithPopup
          .mockResolvedValue({
            user,
          });

        mockProfileMissing();

        await authService
          .loginWithGoogle();

        mockProfileMissing();

        const result =
          await authService
            .cancelGoogleSetup();

        expect(
          deleteUser
        ).toHaveBeenCalledWith(
          user
        );

        expect(
          result
            .deletedIncompleteAccount
        ).toBe(true);
      }
    );

    test(
      "cancel existing profile signs out instead of deleting",
      async () => {
        const user =
          makeUser({
            uid:
              "google-user-123",

            email:
              "existing@gmail.com",

            providerIds: [
              "google.com",
            ],
          });

        signInWithPopup
          .mockResolvedValue({
            user,
          });

        mockProfileFound();

        await authService
          .loginWithGoogle();

        mockProfileFound();

        const result =
          await authService
            .cancelGoogleSetup();

        expect(
          deleteUser
        ).not.toHaveBeenCalled();

        expect(
          signOut
        ).toHaveBeenCalled();

        expect(
          result
            .deletedIncompleteAccount
        ).toBe(false);
      }
    );

    test(
      "auth listener maps provider IDs",
      () => {
        const callback =
          jest.fn();

        const unsubscribe =
          jest.fn();

        onAuthStateChanged
          .mockImplementation(
            (
              firebaseAuth,
              listener
            ) => {
              listener(
                makeUser({
                  email:
                    "daniel@example.com",

                  displayName:
                    "Daniel",

                  providerIds: [
                    "google.com",
                    "password",
                  ],
                })
              );

              return unsubscribe;
            }
          );

        const result =
          authService
            .subscribeToAuthState(
              callback
            );

        expect(
          callback
        ).toHaveBeenCalledWith({
          uid:
            "user-123",

          email:
            "daniel@example.com",

          username:
            "Daniel",

          emailVerified:
            true,

          providerIds: [
            "google.com",
            "password",
          ],
        });

        expect(
          result
        ).toBe(
          unsubscribe
        );
      }
    );

    test(
      "logout signs out",
      async () => {
        const result =
          await authService
            .logout();

        expect(
          signOut
        ).toHaveBeenCalled();

        expect(
          result
        ).toEqual({
          success: true,
        });
      }
    );

    test("changes password after reauthentication", async () => {
      const user = makeUser();
      auth.currentUser = user;

      const result = await authService.changePassword(
        "oldPassword123",
        "newPassword123"
      );

      expect(EmailAuthProvider.credential).toHaveBeenCalledWith(
        "test@example.com",
        "oldPassword123"
      );

      expect(reauthenticateWithCredential).toHaveBeenCalledWith(
        user,
        {
          providerId: "password",
          email: "test@example.com",
          password: "oldPassword123",
        }
      );

      expect(updatePassword).toHaveBeenCalledWith(
        user,
        "newPassword123"
      );

      expect(result).toEqual({ success: true });

      expect(
        reauthenticateWithCredential.mock.invocationCallOrder[0]
      ).toBeLessThan(
        updatePassword.mock.invocationCallOrder[0]
      );
    });

    test("rejects missing, weak, and unchanged passwords", async () => {
      auth.currentUser = makeUser();

      await expect(
        authService.changePassword("", "newPassword123")
      ).rejects.toThrow(
        "Current and new passwords are required."
      );

      await expect(
        authService.changePassword("oldPassword123", "short")
      ).rejects.toThrow(
        "New password must be at least 6 characters long."
      );

      await expect(
        authService.changePassword("samePassword", "samePassword")
      ).rejects.toThrow(
        "New password cannot be the same as the current password."
      );

      expect(reauthenticateWithCredential).not.toHaveBeenCalled();
      expect(updatePassword).not.toHaveBeenCalled();
    });

    test("requires a signed-in password-enabled user", async () => {
      auth.currentUser = null;

      await expect(
        authService.changePassword("oldPassword123", "newPassword123")
      ).rejects.toThrow("Please sign in");

      auth.currentUser = makeUser({
        providerIds: ["google.com"],
      });

      await expect(
        authService.changePassword("oldPassword123", "newPassword123")
      ).rejects.toThrow(
        "This account does not have an email/password sign-in method."
      );

      expect(updatePassword).not.toHaveBeenCalled();
    });

    test("rejects incorrect current password", async () => {
      auth.currentUser = makeUser();

      reauthenticateWithCredential.mockRejectedValue({
        code: "auth/invalid-credential",
      });

      await expect(
        authService.changePassword("wrongPassword", "newPassword123")
      ).rejects.toThrow("Current password is incorrect.");

      expect(updatePassword).not.toHaveBeenCalled();
    });

    test("reports a Firebase password update failure", async () => {
      auth.currentUser = makeUser();

      updatePassword.mockRejectedValue({
        code: "auth/weak-password",
      });

      await expect(
        authService.changePassword("oldPassword123", "newPassword123")
      ).rejects.toThrow(
        "New password does not meet the password requirements."
      );
    });

  }
);