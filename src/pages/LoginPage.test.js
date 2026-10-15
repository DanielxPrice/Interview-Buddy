import React from "react";

import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import {
  MemoryRouter,
} from "react-router-dom";

import LoginPage from "./LoginPage";
import RegisterPage from "./RegisterPage";

import {
  authService,
} from "../services/authService.js";

import {
  useAuth,
} from "../context/AuthContext";

jest.mock(
  "../context/AuthContext",
  () => ({
    useAuth: jest.fn(),
  })
);

jest.mock(
  "../services/authService.js",
  () => ({
    authService: {
      login: jest.fn(),
      loginWithGoogle:
        jest.fn(),

      prepareGoogleUsername:
        jest.fn(),

      prepareGeneratedGoogleUsername:
        jest.fn(),

      completeGoogleRegistration:
        jest.fn(),

      completeGooglePasswordSetup:
        jest.fn(),

      completeExistingPasswordGoogleLink:
        jest.fn(),

      cancelGoogleSetup:
        jest.fn(),

      register:
        jest.fn(),
    },
  })
);

const makeProfile =
  () => ({
    uid:
      "google-user-123",
    username:
      "TestUser",
    usernameLower:
      "testuser",
    email:
      "test@example.com",
    role: "user",
    settings: {
      theme: "light",
    },
  });

const renderLoginPage =
  (
    loginMessage = ""
  ) => {
    const onLogin =
      jest.fn();

    const onGoToRegister =
      jest.fn();

    render(
      <MemoryRouter>
        <LoginPage
          onLogin={
            onLogin
          }
          onGoToRegister={
            onGoToRegister
          }
          loginMessage={
            loginMessage
          }
        />
      </MemoryRouter>
    );

    return {
      onLogin,
      onGoToRegister,
    };
  };

const enterValidCredentials =
  () => {
    fireEvent.change(
      screen.getByPlaceholderText(
        "Email"
      ),
      {
        target: {
          value:
            "test@example.com",
        },
      }
    );

    fireEvent.change(
      screen.getByPlaceholderText(
        "Password"
      ),
      {
        target: {
          value:
            "password123",
        },
      }
    );
  };

beforeEach(() => {
  jest.clearAllMocks();

  useAuth.mockReturnValue({
    user: null,
    profile: null,
    passwordLinked: false,
    profileComplete: false,
    profileError: "",
    loading: false,

    refreshProfile:
      jest
        .fn()
        .mockResolvedValue(
          makeProfile()
        ),
  });

  authService
    .cancelGoogleSetup
    .mockResolvedValue({
      canceled: true,
      deletedIncompleteAccount:
        true,
    });
});

test(
  "authenticated user with no profile returns to username setup",
  async () => {
    useAuth.mockReturnValue({
      user: {
        uid:
          "google-user-123",
        email:
          "unfinished@gmail.com",
        providerIds: [
          "google.com",
        ],
      },

      profile: null,
      passwordLinked: false,
      profileComplete: false,
      profileError: "",
      loading: false,

      refreshProfile:
        jest.fn(),
    });

    const {
      onLogin,
    } = renderLoginPage();

    expect(
      await screen.findByRole(
        "heading",
        {
          name:
            /choose your username/i,
        }
      )
    ).toBeInTheDocument();

    expect(
      screen.getByText(
        /unfinished@gmail.com/i
      )
    ).toBeInTheDocument();

    expect(
      onLogin
    ).not.toHaveBeenCalled();
  }
);

test(
  "Google-only profile requires a password",
  async () => {
    useAuth.mockReturnValue({
      user: {
        uid:
          "google-user-123",
        email:
          "existing@gmail.com",
        providerIds: [
          "google.com",
        ],
      },

      profile: {
        ...makeProfile(),
        email:
          "existing@gmail.com",
      },

      passwordLinked: false,
      profileComplete: false,
      profileError: "",
      loading: false,

      refreshProfile:
        jest.fn(),
    });

    renderLoginPage();

    expect(
      await screen.findByRole(
        "heading",
        {
          name:
            /add a password/i,
        }
      )
    ).toBeInTheDocument();
  }
);

test(
  "displays error when email and password are empty",
  () => {
    renderLoginPage();

    fireEvent.click(
      screen.getByRole(
        "button",
        {
          name:
            /login to workspace/i,
        }
      )
    );

    expect(
      screen.getByText(
        "Please enter both email and password."
      )
    ).toBeInTheDocument();

    expect(
      authService.login
    ).not.toHaveBeenCalled();
  }
);

test(
  "displays error when email is invalid",
  () => {
    renderLoginPage();

    fireEvent.change(
      screen.getByPlaceholderText(
        "Email"
      ),
      {
        target: {
          value:
            "bryanexample.com",
        },
      }
    );

    fireEvent.change(
      screen.getByPlaceholderText(
        "Password"
      ),
      {
        target: {
          value:
            "password123",
        },
      }
    );

    fireEvent.click(
      screen.getByRole(
        "button",
        {
          name:
            /login to workspace/i,
        }
      )
    );

    expect(
      screen.getByText(
        "Please enter a valid email"
      )
    ).toBeInTheDocument();

    expect(
      authService.login
    ).not.toHaveBeenCalled();
  }
);

test(
  "logs in through auth service",
  async () => {
    authService
      .login
      .mockResolvedValue({
        authenticated:
          true,
      });

    const {
      onLogin,
    } = renderLoginPage();

    enterValidCredentials();

    fireEvent.click(
      screen.getByRole(
        "button",
        {
          name:
            /login to workspace/i,
        }
      )
    );

    await waitFor(() =>
      expect(
        onLogin
      ).toHaveBeenCalledTimes(
        1
      )
    );

    expect(
      authService.login
    ).toHaveBeenCalledWith({
      email:
        "test@example.com",
      password:
        "password123",
    });
  }
);

test(
  "existing Google user with both providers enters application",
  async () => {
    authService
      .loginWithGoogle
      .mockResolvedValue({
        authenticated:
          true,

        needsUsernameSetup:
          false,

        needsPasswordSetup:
          false,

        user: {
          uid:
            "google-user-123",

          email:
            "existing@gmail.com",

          username:
            "ExistingUser",

          providerIds: [
            "google.com",
            "password",
          ],
        },
      });

    const {
      onLogin,
    } = renderLoginPage();

    fireEvent.click(
      screen.getByRole(
        "button",
        {
          name:
            /continue with google/i,
        }
      )
    );

    await waitFor(() =>
      expect(
        onLogin
      ).toHaveBeenCalledTimes(
        1
      )
    );
  }
);

test(
  "new Google user sees username step",
  async () => {
    authService
      .loginWithGoogle
      .mockResolvedValue({
        authenticated:
          true,

        needsUsernameSetup:
          true,

        needsPasswordSetup:
          true,

        user: {
          uid:
            "google-user-123",

          email:
            "newgoogle@gmail.com",
        },
      });

    const {
      onLogin,
    } = renderLoginPage();

    fireEvent.click(
      screen.getByRole(
        "button",
        {
          name:
            /continue with google/i,
        }
      )
    );

    expect(
      await screen.findByRole(
        "heading",
        {
          name:
            /choose your username/i,
        }
      )
    ).toBeInTheDocument();

    expect(
      onLogin
    ).not.toHaveBeenCalled();
  }
);

test(
  "choosing username moves to password step",
  async () => {
    authService
      .loginWithGoogle
      .mockResolvedValue({
        authenticated:
          true,

        needsUsernameSetup:
          true,

        needsPasswordSetup:
          true,

        user: {
          uid:
            "google-user-123",

          email:
            "newgoogle@gmail.com",
        },
      });

    authService
      .prepareGoogleUsername
      .mockResolvedValue({
        needsPasswordSetup:
          true,

        username:
          "InterviewDaniel",
      });

    renderLoginPage();

    fireEvent.click(
      screen.getByRole(
        "button",
        {
          name:
            /continue with google/i,
        }
      )
    );

    fireEvent.change(
      await screen.findByPlaceholderText(
        "Choose a username"
      ),
      {
        target: {
          value:
            "InterviewDaniel",
        },
      }
    );

    fireEvent.click(
      screen.getByRole(
        "button",
        {
          name:
            /^continue$/i,
        }
      )
    );

    expect(
      await screen.findByRole(
        "heading",
        {
          name:
            /create your password/i,
        }
      )
    ).toBeInTheDocument();

    expect(
      authService
        .prepareGoogleUsername
    ).toHaveBeenCalledWith(
      "InterviewDaniel"
    );
  }
);

test(
  "new Google user logs in only after required password succeeds",
  async () => {
    const refreshProfile =
      jest
        .fn()
        .mockResolvedValue(
          makeProfile()
        );

    useAuth.mockReturnValue({
      user: null,
      profile: null,
      passwordLinked:
        false,
      profileComplete:
        false,
      profileError: "",
      loading: false,
      refreshProfile,
    });

    authService
      .loginWithGoogle
      .mockResolvedValue({
        authenticated:
          true,

        needsUsernameSetup:
          true,

        needsPasswordSetup:
          true,

        user: {
          uid:
            "google-user-123",

          email:
            "newgoogle@gmail.com",
        },
      });

    authService
      .prepareGoogleUsername
      .mockResolvedValue({
        needsPasswordSetup:
          true,

        username:
          "InterviewDaniel",
      });

    authService
      .completeGoogleRegistration
      .mockResolvedValue({
        authenticated:
          true,

        needsUsernameSetup:
          false,

        needsPasswordSetup:
          false,

        profile:
          makeProfile(),
      });

    const {
      onLogin,
    } = renderLoginPage();

    fireEvent.click(
      screen.getByRole(
        "button",
        {
          name:
            /continue with google/i,
        }
      )
    );

    fireEvent.change(
      await screen.findByPlaceholderText(
        "Choose a username"
      ),
      {
        target: {
          value:
            "InterviewDaniel",
        },
      }
    );

    fireEvent.click(
      screen.getByRole(
        "button",
        {
          name:
            /^continue$/i,
        }
      )
    );

    fireEvent.change(
      await screen.findByPlaceholderText(
        "Create a password"
      ),
      {
        target: {
          value:
            "password123",
        },
      }
    );

    fireEvent.change(
      screen.getByPlaceholderText(
        "Confirm password"
      ),
      {
        target: {
          value:
            "password123",
        },
      }
    );

    fireEvent.click(
      screen.getByRole(
        "button",
        {
          name:
            /finish account setup/i,
        }
      )
    );

    await waitFor(() =>
      expect(
        authService
          .completeGoogleRegistration
      ).toHaveBeenCalledWith({
        password:
          "password123",

        confirmPassword:
          "password123",
      })
    );

    await waitFor(() =>
      expect(
        onLogin
      ).toHaveBeenCalledTimes(
        1
      )
    );
  }
);

test(
  "password mismatch blocks Google account completion",
  async () => {
    authService
      .loginWithGoogle
      .mockResolvedValue({
        authenticated:
          true,

        needsUsernameSetup:
          true,

        needsPasswordSetup:
          true,

        user: {
          uid:
            "google-user-123",

          email:
            "newgoogle@gmail.com",
        },
      });

    authService
      .prepareGoogleUsername
      .mockResolvedValue({
        needsPasswordSetup:
          true,

        username:
          "InterviewDaniel",
      });

    renderLoginPage();

    fireEvent.click(
      screen.getByRole(
        "button",
        {
          name:
            /continue with google/i,
        }
      )
    );

    fireEvent.change(
      await screen.findByPlaceholderText(
        "Choose a username"
      ),
      {
        target: {
          value:
            "InterviewDaniel",
        },
      }
    );

    fireEvent.click(
      screen.getByRole(
        "button",
        {
          name:
            /^continue$/i,
        }
      )
    );

    fireEvent.change(
      await screen.findByPlaceholderText(
        "Create a password"
      ),
      {
        target: {
          value:
            "onepass",
        },
      }
    );

    fireEvent.change(
      screen.getByPlaceholderText(
        "Confirm password"
      ),
      {
        target: {
          value:
            "different",
        },
      }
    );

    fireEvent.click(
      screen.getByRole(
        "button",
        {
          name:
            /finish account setup/i,
        }
      )
    );

    expect(
      screen.getByRole(
        "alert"
      )
    ).toHaveTextContent(
      "Passwords do not match."
    );

    expect(
      authService
        .completeGoogleRegistration
    ).not.toHaveBeenCalled();
  }
);

test(
  "generated username still requires password",
  async () => {
    authService
      .loginWithGoogle
      .mockResolvedValue({
        authenticated:
          true,

        needsUsernameSetup:
          true,

        needsPasswordSetup:
          true,

        user: {
          uid:
            "google-user-123",

          email:
            "newgoogle@gmail.com",
        },
      });

    authService
      .prepareGeneratedGoogleUsername
      .mockResolvedValue({
        needsPasswordSetup:
          true,

        username:
          "newgoogle_abcdef",

        generatedUsername:
          "newgoogle_abcdef",
      });

    renderLoginPage();

    fireEvent.click(
      screen.getByRole(
        "button",
        {
          name:
            /continue with google/i,
        }
      )
    );

    await screen.findByRole(
      "heading",
      {
        name:
          /choose your username/i,
      }
    );

    fireEvent.click(
      screen.getByRole(
        "button",
        {
          name:
            /skip.*assign me a username/i,
        }
      )
    );

    expect(
      await screen.findByRole(
        "heading",
        {
          name:
            /create your password/i,
        }
      )
    ).toBeInTheDocument();

    expect(
      screen.getByText(
        "newgoogle_abcdef"
      )
    ).toBeInTheDocument();
  }
);

test(
  "password-first account can confirm password and link Google",
  async () => {
    const refreshProfile =
      jest
        .fn()
        .mockResolvedValue(
          makeProfile()
        );

    useAuth.mockReturnValue({
      user: null,
      profile: null,
      passwordLinked:
        false,
      profileComplete:
        false,
      profileError: "",
      loading: false,
      refreshProfile,
    });

    authService
      .loginWithGoogle
      .mockResolvedValue({
        authenticated:
          false,

        needsExistingPasswordToLinkGoogle:
          true,

        email:
          "existing@example.com",
      });

    authService
      .completeExistingPasswordGoogleLink
      .mockResolvedValue({
        authenticated:
          true,

        needsUsernameSetup:
          false,

        needsPasswordSetup:
          false,

        profile:
          makeProfile(),
      });

    const {
      onLogin,
    } = renderLoginPage();

    fireEvent.click(
      screen.getByRole(
        "button",
        {
          name:
            /continue with google/i,
        }
      )
    );

    expect(
      await screen.findByRole(
        "heading",
        {
          name:
            /confirm your existing account/i,
        }
      )
    ).toBeInTheDocument();

    fireEvent.change(
      screen.getByPlaceholderText(
        "Existing password"
      ),
      {
        target: {
          value:
            "password123",
        },
      }
    );

    fireEvent.click(
      screen.getByRole(
        "button",
        {
          name:
            /link google account/i,
        }
      )
    );

    await waitFor(() =>
      expect(
        authService
          .completeExistingPasswordGoogleLink
      ).toHaveBeenCalledWith(
        "password123"
      )
    );

    await waitFor(() =>
      expect(
        onLogin
      ).toHaveBeenCalledTimes(
        1
      )
    );
  }
);

test(
  "canceling Google registration calls cancellation service",
  async () => {
    authService
      .loginWithGoogle
      .mockResolvedValue({
        authenticated:
          true,

        needsUsernameSetup:
          true,

        needsPasswordSetup:
          true,

        user: {
          uid:
            "google-user-123",

          email:
            "newgoogle@gmail.com",
        },
      });

    renderLoginPage();

    fireEvent.click(
      screen.getByRole(
        "button",
        {
          name:
            /continue with google/i,
        }
      )
    );

    await screen.findByRole(
      "heading",
      {
        name:
          /choose your username/i,
      }
    );

    fireEvent.click(
      screen.getByRole(
        "button",
        {
          name:
            /cancel account creation/i,
        }
      )
    );

    await waitFor(() =>
      expect(
        authService
          .cancelGoogleSetup
      ).toHaveBeenCalledTimes(
        1
      )
    );

    expect(
      await screen.findByRole(
        "heading",
        {
          name:
            /welcome back/i,
        }
      )
    ).toBeInTheDocument();
  }
);

test(
  "preserves registration action",
  () => {
    const {
      onGoToRegister,
    } = renderLoginPage(
      "Your account has been successfully deleted."
    );

    expect(
      screen.getByRole(
        "status"
      )
    ).toHaveTextContent(
      "Your account has been successfully deleted."
    );

    fireEvent.click(
      screen.getByRole(
        "button",
        {
          name:
            "Create Account",
        }
      )
    );

    expect(
      onGoToRegister
    ).toHaveBeenCalledTimes(
      1
    );
  }
);

test(
  "keeps password reset route available",
  () => {
    renderLoginPage();

    expect(
      screen.getByRole(
        "link",
        {
          name:
            /forgot password/i,
        }
      )
    ).toHaveAttribute(
      "href",
      "/forgot-password"
    );
  }
);

test(
  "handles stored XSS input in username",
  () => {
    render(
      <RegisterPage
        onRegister={
          jest.fn()
        }
        onGoToLogin={
          jest.fn()
        }
      />
    );

    const usernameInput =
      screen
        .getByPlaceholderText(
          "Username"
        );

    const maliciousInput =
      '<script>alert("Hacked!")</script>';

    fireEvent.change(
      usernameInput,
      {
        target: {
          value:
            maliciousInput,
        },
      }
    );

    expect(
      usernameInput.value
    ).toBe(
      maliciousInput
    );
  }
);