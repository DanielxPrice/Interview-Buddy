import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import App from "./App";

jest.mock("./config/firebase", () => ({
  __esModule: true,
  auth: {
    currentUser: null,
  },
  default: {},
}));

jest.mock("./context/AuthContext", () => ({
  useAuth: jest.fn(),
}));

// App imports all routes, including SettingsPage.
// Mock it because these routing tests do not need
// the real settings/Firebase behavior.
jest.mock("./pages/SettingsPage", () => {
  return function MockSettingsPage() {
    return <div>Settings Page</div>;
  };
});

// App also imports the interview session route.
// Mock CodeEditor so App routing tests do not load
// CodeMirror's ESM dependencies in Jest.
jest.mock("./components/interview/CodeEditor", () => ({
  __esModule: true,
  default: function MockCodeEditor() {
    return null;
  },
}));


function renderAtRoute(route) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <App />
    </MemoryRouter>,
  );
}

describe("Interview Buddy application routing", () => {
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

      refreshProfile: jest
        .fn()
        .mockResolvedValue({
          uid: "test-user",
          username: "TestUser",
          usernameLower: "testuser",
          email: "test@example.com",
          role: "user",
          settings: {
            theme: "light",
          },
        }),
    });
  });

  test("the base URL redirects to the login page", async () => {
    renderAtRoute("/");

    expect(
      await screen.findByRole("heading", {
        name: "Interview Buddy",
      }),
    ).toBeInTheDocument();
  });

  test("the login URL displays the login page", async () => {
    renderAtRoute("/login");

    expect(
      await screen.findByRole("heading", {
        name: "Interview Buddy",
      }),
    ).toBeInTheDocument();

    expect(
      screen.getByRole("button", {
        name: /login to workspace/i,
      }),
    ).toBeInTheDocument();
  });

  test("the dashboard URL displays the dashboard", async () => {
    renderAtRoute("/dashboard");

    expect(
      await screen.findByRole("heading", {
        name: "Dashboard",
      }),
    ).toBeInTheDocument();
  });

  test("a direct history URL displays the history page", async () => {
    renderAtRoute("/history");

    expect(
      await screen.findByRole("heading", {
        name: "Chat History",
      }),
    ).toBeInTheDocument();
  });

  test("an unknown URL redirects to the dashboard", async () => {
    renderAtRoute("/this-route-does-not-exist");

    expect(
      await screen.findByRole("heading", {
        name: "Dashboard",
      }),
    ).toBeInTheDocument();
  });

  test("Create Account navigates from login to register", async () => {
    renderAtRoute("/login");

    userEvent.click(
      screen.getByRole("button", {
        name: "Create Account",
      }),
    );

    expect(
      await screen.findByRole("heading", {
        name: "Create Account",
      }),
    ).toBeInTheDocument();
  });

  test("Back to Login navigates from register to login", async () => {
    renderAtRoute("/register");

    userEvent.click(
      screen.getByRole("button", {
        name: "Back to Login",
      }),
    );

    expect(
      await screen.findByRole("heading", {
        name: "Interview Buddy",
      }),
    ).toBeInTheDocument();
  });

  test("selecting Quiz Style navigates to interview setup", async () => {
    renderAtRoute("/dashboard");

    userEvent.click(
      screen.getByRole("button", {
        name: /start quiz/i,
      }),
    );

    expect(
      await screen.findByRole("heading", {
        name: "Interview Setup",
      }),
    ).toBeInTheDocument();

    expect(screen.getByText("Selected Mode: Quiz Style")).toBeInTheDocument();
  });

  test("selecting Code Style preserves the selected mode", async () => {
    renderAtRoute("/dashboard");

    userEvent.click(
      screen.getByRole("button", {
        name: /start coding/i,
      }),
    );

    expect(
      await screen.findByText("Selected Mode: Code Style"),
    ).toBeInTheDocument();
  });

  test("selecting Theoretical Style preserves the selected mode", async () => {
    renderAtRoute("/dashboard");

    userEvent.click(
      screen.getByRole("button", {
        name: /start review/i,
      }),
    );

    expect(
      await screen.findByText("Selected Mode: Theoretical Style"),
    ).toBeInTheDocument();
  });
});
