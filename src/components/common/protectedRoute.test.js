import React from "react";
import {
  render,
  screen,
} from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
} from "react-router-dom";

import ProtectedRoute from "./protectedRoute";
import { useAuth } from "../../context/AuthContext";
import { PAGES } from "../../utils/constants";

jest.mock("../../context/AuthContext", () => ({
  useAuth: jest.fn(),
}));

function renderProtectedRoute() {
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

describe("ProtectedRoute", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("allows an authenticated user to access protected content", () => {
    useAuth.mockReturnValue({
      user: {
        uid: "test-user",
        email: "test@example.com",
      },
      loading: false,
      profileComplete: true,
      profileError: "",
    });

    renderProtectedRoute();

    expect(
      screen.getByText("Protected Content")
    ).toBeInTheDocument();

    expect(
      screen.queryByText("Login Page")
    ).not.toBeInTheDocument();
  });

  test("redirects an unauthenticated user to login", async () => {
    useAuth.mockReturnValue({
      user: null,
      loading: false,
      profileComplete: false,
      profileError: "",
    });

    renderProtectedRoute();

    expect(
      await screen.findByText("Login Page")
    ).toBeInTheDocument();

    expect(
      screen.queryByText("Protected Content")
    ).not.toBeInTheDocument();
  });

  test("shows loading state while authentication is resolving", () => {
    useAuth.mockReturnValue({
      user: null,
      loading: true,
      profileComplete: false,
      profileError: "",
    });

    renderProtectedRoute();

    expect(
      screen.getByText("Loading...")
    ).toBeInTheDocument();

    expect(
      screen.queryByText("Protected Content")
    ).not.toBeInTheDocument();

    expect(
      screen.queryByText("Login Page")
    ).not.toBeInTheDocument();
  });

  test(
    "redirects authenticated users without an application profile",
    async () => {
      useAuth.mockReturnValue({
        user: {
          uid: "google-user",
          email: "google@example.com",
        },
        loading: false,
        profileComplete: false,
        profileError: "",
      });

      renderProtectedRoute();

      expect(
        await screen.findByText(
          "Login Page"
        )
      ).toBeInTheDocument();

      expect(
        screen.queryByText(
          "Protected Content"
        )
      ).not.toBeInTheDocument();
    }
  );

  test(
    "does not allow protected access when profile verification fails",
    () => {
      useAuth.mockReturnValue({
        user: {
          uid: "test-user",
          email: "test@example.com",
        },
        loading: false,
        profileComplete: false,
        profileError:
          "Profile service unavailable.",
      });

      renderProtectedRoute();

      expect(
        screen.getByRole("alert")
      ).toHaveTextContent(
        /unable to verify your interview buddy profile/i
      );

      expect(
        screen.queryByText(
          "Protected Content"
        )
      ).not.toBeInTheDocument();
    }
  );
});