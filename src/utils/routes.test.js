import React from "react";
import { useAuth } from "../context/AuthContext";
import {
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  MemoryRouter,
  useLocation,
} from "react-router-dom";

import AppRoutes from "./routes";
import { PAGES } from "./constants";

jest.mock("../context/AuthContext", () => ({
  useAuth: jest.fn(),
}));

jest.mock("../pages/LoginPage", () => () => <div>Login Route</div>);

jest.mock("../pages/RegisterPage", () => () => <div>Register Route</div>);

jest.mock("../pages/DashboardPage", () => () => <div>Dashboard Route</div>);

jest.mock("../pages/InterviewSetupPage", () => () => (
  <div>Interview Setup Route</div>
));

jest.mock("../pages/InterviewSessionPage", () => () => (
  <div>Interview Session Route</div>
));

jest.mock("../pages/SessionResultsPage", () => () => (
  <div>Session Results Route</div>
));

jest.mock("../pages/HistoryPage", () => () => <div>History Route</div>);

jest.mock("../pages/LeaderboardPage", () => () => <div>Leaderboard Route</div>);

jest.mock("../pages/AnalyticsPage", () => () => <div>Analytics Route</div>);

jest.mock("../pages/SettingsPage", () => () => <div>Settings Route</div>);


jest.mock("../pages/ForgotPasswordPage", () => () => (
  <div>Forgot Password Route</div>
));

function LocationDisplay() {
  const location = useLocation();

  return <div data-testid="current-location">{location.pathname}</div>;
}

function createRouteProps() {
  return {
    currentPage: "",
    onNavigate: jest.fn(),
    onSelectMode: jest.fn(),
    onStartInterview: jest.fn(),
    onEndInterview: jest.fn(),
    onAccountDeleted: jest.fn(),
    loginMessage: "",
    selectedMode: "Quiz Style",

    setupData: {
      jobRole: "Software Engineer",
      experienceLevel: "Intermediate",
      tags: ["technical interview practice"],
    },

    sessionResult: {
      mode: "Quiz Style",
      date: "May 4, 2026",
      score: "80%",
      questionsAnswered: 5,
      eloChange: "+10",
      isCorrect: true,
      answerSubmitted: true,
    },
  };
}

function renderRoute(path) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes {...createRouteProps()} />
      <LocationDisplay />
    </MemoryRouter>,
  );
}

describe("AppRoutes", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    useAuth.mockReturnValue({
      user: {
        uid: "test-user",
        email: "test@example.com",
      },

      profile: {
        uid: "test-user",
        username: "TestUser",
        usernameLower: "testuser",
        email: "test@example.com",
        role: "user",
        settings: {
          theme: "light",
        },
      },

      profileComplete: true,
      profileError: "",
      loading: false,
    });
  });
  test.each([
    [PAGES.LOGIN, "Login Route"],
    [PAGES.REGISTER, "Register Route"],
    [PAGES.DASHBOARD, "Dashboard Route"],
    [PAGES.INTERVIEW_SETUP, "Interview Setup Route"],
    [PAGES.INTERVIEW, "Interview Session Route"],
    [PAGES.SESSION_RESULTS, "Session Results Route"],
    [PAGES.HISTORY, "History Route"],
    [PAGES.LEADERBOARD, "Leaderboard Route"],
    [PAGES.ANALYTICS, "Analytics Route"],
    [PAGES.SETTINGS, "Settings Route"],
    [PAGES.FORGOT_PASSWORD, "Forgot Password Route"],
  ])("renders the correct page for %s", (path, expectedPage) => {
    renderRoute(path);

    expect(screen.getByText(expectedPage)).toBeInTheDocument();

    expect(screen.getByTestId("current-location")).toHaveTextContent(path);
  });

  test(
    "redirects an authenticated user without a completed profile to login",
    async () => {
      useAuth.mockReturnValue({
        user: {
          uid: "google-user-123",
          email: "unfinished@gmail.com",
        },
        profile: null,
        profileComplete: false,
        profileError: "",
        loading: false,
      });

      renderRoute(PAGES.DASHBOARD);

      await waitFor(() => {
        expect(
          screen.getByText("Login Route")
        ).toBeInTheDocument();
      });

      expect(
        screen.getByTestId(
          "current-location"
        )
      ).toHaveTextContent(
        PAGES.LOGIN
      );
    }
  );

  test("redirects the base URL to the login route", async () => {
    renderRoute("/");

    await waitFor(() => {
      expect(screen.getByText("Login Route")).toBeInTheDocument();
    });

    expect(screen.getByTestId("current-location")).toHaveTextContent(
      PAGES.LOGIN,
    );
  });

  test("redirects an unknown URL to the dashboard", async () => {
    renderRoute("/route-that-does-not-exist");

    await waitFor(() => {
      expect(screen.getByText("Dashboard Route")).toBeInTheDocument();
    });

    expect(screen.getByTestId("current-location")).toHaveTextContent(
      PAGES.DASHBOARD,
    );
  });
  test.each([
    PAGES.DASHBOARD,
    PAGES.INTERVIEW_SETUP,
    PAGES.INTERVIEW,
    PAGES.SESSION_RESULTS,
    PAGES.HISTORY,
    PAGES.LEADERBOARD,
    PAGES.ANALYTICS,
    PAGES.SETTINGS,
    PAGES.CHANGE_PASSWORD,
  ])(
    "redirects an unauthenticated user from %s to login",
    async (path) => {
      useAuth.mockReturnValue({
        user: null,
        profile: null,
        profileComplete: false,
        profileError: "",
        loading: false,
      });

      renderRoute(path);

      await waitFor(() => {
        expect(
          screen.getByText("Login Route")
        ).toBeInTheDocument();
      });

      expect(
        screen.getByTestId("current-location")
      ).toHaveTextContent(PAGES.LOGIN);
    }
  );


  test("redirects the legacy password URL to Settings", async () => {
    renderRoute(PAGES.CHANGE_PASSWORD);

    await waitFor(() => {
      expect(
        screen.getByText("Settings Route")
      ).toBeInTheDocument();
    });

    expect(
      screen.getByTestId("current-location")
    ).toHaveTextContent(PAGES.SETTINGS);
  });

  test("does not redirect while authentication is still loading", () => {
    useAuth.mockReturnValue({
      user: null,
      profile: null,
      profileComplete: false,
      profileError: "",
      loading: true,
    });

    renderRoute(PAGES.DASHBOARD);

    expect(
      screen.getByText("Loading...")
    ).toBeInTheDocument();

    expect(
      screen.queryByText("Login Route")
    ).not.toBeInTheDocument();

    expect(
      screen.getByTestId("current-location")
    ).toHaveTextContent(PAGES.DASHBOARD);
  });
  test.each([
    [PAGES.LOGIN, "Login Route"],
    [PAGES.REGISTER, "Register Route"],
    [PAGES.FORGOT_PASSWORD, "Forgot Password Route"],
  ])(
    "allows an unauthenticated user to access public route %s",
    (path, expectedPage) => {
      useAuth.mockReturnValue({
        user: null,
        profile: null,
        profileComplete: false,
        profileError: "",
        loading: true,
      });

      renderRoute(path);

      expect(
        screen.getByText(expectedPage)
      ).toBeInTheDocument();

      expect(
        screen.getByTestId("current-location")
      ).toHaveTextContent(path);
    }
  );
});
