
import React from "react";

import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import {
  MemoryRouter,
  Route,
  Routes,
} from "react-router-dom";

import ProtectedRoute from "./protectedRoute";
import { useAuth } from "../../context/AuthContext";
import { emailVerificationService } from "../../services/emailVerificationService";
import { PAGES } from "../../utils/constants";

jest.mock("../../context/AuthContext", () => ({
  useAuth: jest.fn(),
}));

jest.mock("../../services/emailVerificationService", () => ({
  emailVerificationService: {
    send: jest.fn(),
    check: jest.fn(),
    signOut: jest.fn(),
  },
}));

function renderRoute(state) {
  useAuth.mockReturnValue({
    user: {
      uid: "u1",
      email: "test@example.com",
      emailVerified: true,
    },
    loading: false,
    profileComplete: true,
    profileError: "",
    refreshProfile: jest.fn().mockResolvedValue({
      uid: "u1",
    }),
    ...state,
  });

  render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <Routes>
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <div>Protected Content</div>
            </ProtectedRoute>
          }
        />

        <Route
          path={PAGES.LOGIN}
          element={<div>Login Page</div>}
        />
      </Routes>
    </MemoryRouter>
  );
}

describe("SEC-02 protected frontend admission", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("accepts a verified user with a complete profile", () => {
    renderRoute();

    expect(
      screen.getByText("Protected Content")
    ).toBeInTheDocument();
  });

  test("redirects unauthenticated users", async () => {
    renderRoute({
      user: null,
    });

    expect(
      await screen.findByText("Login Page")
    ).toBeInTheDocument();
  });

  test("shows a loading state while auth is resolving", () => {
    renderRoute({
      loading: true,
    });

    expect(
      screen.getByText("Loading...")
    ).toBeInTheDocument();
  });

  test("keeps incomplete Google/password onboarding on login", async () => {
    renderRoute({
      profileComplete: false,
    });

    expect(
      await screen.findByText("Login Page")
    ).toBeInTheDocument();
  });

  test("fails closed if loading the profile failed", () => {
    renderRoute({
      profileError: "Profile unavailable",
    });

    expect(
      screen.getByRole("alert")
    ).toHaveTextContent(
      /unable to verify/i
    );
  });

  test("blocks an unverified email and offers an email action", async () => {
    emailVerificationService.send.mockResolvedValue(
      undefined
    );

    renderRoute({
      user: {
        uid: "u1",
        email: "test@example.com",
        emailVerified: false,
      },
    });

    expect(
      screen.queryByText("Protected Content")
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: /send verification email/i,
      })
    );

    await waitFor(() =>
      expect(
        emailVerificationService.send
      ).toHaveBeenCalledTimes(1)
    );

    expect(
      await screen.findByRole("status")
    ).toHaveTextContent(/email sent/i);
  });

  test("refreshes the profile after confirming verification", async () => {
    emailVerificationService.check.mockResolvedValue(
      true
    );

    const refreshProfile =
      jest.fn().mockResolvedValue({
        uid: "u1",
      });

    renderRoute({
      user: {
        uid: "u1",
        email: "test@example.com",
        emailVerified: false,
      },
      refreshProfile,
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: /i've verified my email/i,
      })
    );

    await waitFor(() =>
      expect(
        refreshProfile
      ).toHaveBeenCalledTimes(1)
    );
  });

  test("does not grant access when verification is still pending", async () => {
    emailVerificationService.check.mockResolvedValue(
      false
    );

    renderRoute({
      user: {
        uid: "u1",
        email: "test@example.com",
        emailVerified: false,
      },
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: /i've verified my email/i,
      })
    );

    expect(
      await screen.findByRole("status")
    ).toHaveTextContent(
      /not verified yet/i
    );

    expect(
      screen.queryByText("Protected Content")
    ).not.toBeInTheDocument();
  });
});
