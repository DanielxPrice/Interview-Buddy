import React from "react";

import {
  act,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import {
  AuthProvider,
  useAuth,
} from "./AuthContext";

import {
  authService,
} from "../services/authService";

jest.mock(
  "../services/authService",
  () => ({
    authService: {
      subscribeToAuthState:
        jest.fn(),
      getCurrentUserProfile:
        jest.fn(),
      getCurrentUser:
        jest.fn(),
    },
  })
);

function TestConsumer() {
  const {
    user,
    profile,
    passwordLinked,
    profileComplete,
    loading,
  } = useAuth();

  return (
    <div>
      <div
        data-testid="loading"
      >
        {loading
          ? "loading"
          : "ready"}
      </div>

      <div
        data-testid="user"
      >
        {user
          ? user.email
          : "no-user"}
      </div>

      <div
        data-testid="profile"
      >
        {profile
          ? profile.username
          : "no-profile"}
      </div>

      <div
        data-testid="password-linked"
      >
        {passwordLinked
          ? "yes"
          : "no"}
      </div>

      <div
        data-testid="profile-complete"
      >
        {profileComplete
          ? "yes"
          : "no"}
      </div>
    </div>
  );
}

describe(
  "AuthContext",
  () => {
    let authCallback;
    let unsubscribe;

    beforeEach(() => {
      jest.clearAllMocks();

      unsubscribe =
        jest.fn();

      authService
        .getCurrentUserProfile
        .mockResolvedValue({
          uid:
            "test-user",
          username:
            "TestUser",
          email:
            "test@example.com",
        });

      authService
        .getCurrentUser
        .mockReturnValue({
          uid:
            "test-user",
          email:
            "test@example.com",
          username:
            "TestUser",
          emailVerified:
            true,
          providerIds: [
            "password",
          ],
        });

      authService
        .subscribeToAuthState
        .mockImplementation(
          (callback) => {
            authCallback =
              callback;

            return unsubscribe;
          }
        );
    });

    test(
      "starts in loading state before Firebase auth resolves",
      () => {
        render(
          <AuthProvider>
            <TestConsumer />
          </AuthProvider>
        );

        expect(
          screen.getByTestId(
            "loading"
          )
        ).toHaveTextContent(
          "loading"
        );

        expect(
          screen.getByTestId(
            "user"
          )
        ).toHaveTextContent(
          "no-user"
        );

        expect(
          authService
            .subscribeToAuthState
        ).toHaveBeenCalledTimes(
          1
        );
      }
    );

    test(
      "marks an email-password user with a profile as complete",
      async () => {
        render(
          <AuthProvider>
            <TestConsumer />
          </AuthProvider>
        );

        act(() => {
          authCallback({
            uid:
              "test-user",
            email:
              "test@example.com",
            username:
              "TestUser",
            emailVerified:
              true,
            providerIds: [
              "password",
            ],
          });
        });

        await waitFor(() =>
          expect(
            screen.getByTestId(
              "loading"
            )
          ).toHaveTextContent(
            "ready"
          )
        );

        expect(
          screen.getByTestId(
            "password-linked"
          )
        ).toHaveTextContent(
          "yes"
        );

        expect(
          screen.getByTestId(
            "profile-complete"
          )
        ).toHaveTextContent(
          "yes"
        );
      }
    );

    test(
      "keeps a Google-only user incomplete even when a Firestore profile exists",
      async () => {
        render(
          <AuthProvider>
            <TestConsumer />
          </AuthProvider>
        );

        act(() => {
          authCallback({
            uid:
              "google-user",
            email:
              "google@example.com",
            username:
              "GoogleUser",
            emailVerified:
              true,
            providerIds: [
              "google.com",
            ],
          });
        });

        await waitFor(() =>
          expect(
            screen.getByTestId(
              "loading"
            )
          ).toHaveTextContent(
            "ready"
          )
        );

        expect(
          screen.getByTestId(
            "password-linked"
          )
        ).toHaveTextContent(
          "no"
        );

        expect(
          screen.getByTestId(
            "profile-complete"
          )
        ).toHaveTextContent(
          "no"
        );
      }
    );

    test(
      "marks a Google and password user with a profile as complete",
      async () => {
        render(
          <AuthProvider>
            <TestConsumer />
          </AuthProvider>
        );

        act(() => {
          authCallback({
            uid:
              "google-user",
            email:
              "google@example.com",
            username:
              "GoogleUser",
            emailVerified:
              true,
            providerIds: [
              "google.com",
              "password",
            ],
          });
        });

        await waitFor(() =>
          expect(
            screen.getByTestId(
              "loading"
            )
          ).toHaveTextContent(
            "ready"
          )
        );

        expect(
          screen.getByTestId(
            "profile-complete"
          )
        ).toHaveTextContent(
          "yes"
        );
      }
    );

    test(
      "keeps an authenticated user incomplete when the Firestore profile is missing",
      async () => {
        authService
          .getCurrentUserProfile
          .mockResolvedValue(
            null
          );

        render(
          <AuthProvider>
            <TestConsumer />
          </AuthProvider>
        );

        act(() => {
          authCallback({
            uid:
              "test-user",
            email:
              "test@example.com",
            username:
              "TestUser",
            emailVerified:
              true,
            providerIds: [
              "password",
            ],
          });
        });

        await waitFor(() =>
          expect(
            screen.getByTestId(
              "loading"
            )
          ).toHaveTextContent(
            "ready"
          )
        );

        expect(
          screen.getByTestId(
            "profile"
          )
        ).toHaveTextContent(
          "no-profile"
        );

        expect(
          screen.getByTestId(
            "profile-complete"
          )
        ).toHaveTextContent(
          "no"
        );
      }
    );

    test(
      "sets user to null when no session exists",
      () => {
        render(
          <AuthProvider>
            <TestConsumer />
          </AuthProvider>
        );

        act(() => {
          authCallback(
            null
          );
        });

        expect(
          screen.getByTestId(
            "loading"
          )
        ).toHaveTextContent(
          "ready"
        );

        expect(
          screen.getByTestId(
            "user"
          )
        ).toHaveTextContent(
          "no-user"
        );

        expect(
          screen.getByTestId(
            "profile-complete"
          )
        ).toHaveTextContent(
          "no"
        );
      }
    );

    test(
      "unsubscribes when provider unmounts",
      () => {
        const {
          unmount,
        } = render(
          <AuthProvider>
            <TestConsumer />
          </AuthProvider>
        );

        unmount();

        expect(
          unsubscribe
        ).toHaveBeenCalledTimes(
          1
        );
      }
    );
  }
);