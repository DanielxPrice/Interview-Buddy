import {
  useEffect,
  useState,
} from "react";

import {
  Link,
} from "react-router-dom";

import AuthShell from "../components/auth/AuthShell";

import {
  useAuth,
} from "../context/AuthContext";

import {
  authService,
} from "../services/authService.js";

import {
  PAGES,
} from "../utils/constants";

const GOOGLE_STEPS =
  Object.freeze({
    NONE: "",
    USERNAME: "username",
    PASSWORD: "password",
    EXISTING_PASSWORD:
      "existing-password",
  });

function LoginPage({
  onLogin,
  onGoToRegister,
  loginMessage,
}) {
  const {
    user:
      authenticatedUser,
    profile,
    profileComplete,
    profileError,
    loading: authLoading,
    refreshProfile,
  } = useAuth();

  const [
    email,
    setEmail,
  ] = useState("");

  const [
    password,
    setPassword,
  ] = useState("");

  const [
    error,
    setError,
  ] = useState("");

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    googleStep,
    setGoogleStep,
  ] = useState(
    GOOGLE_STEPS.NONE
  );

  const [
    googleUsername,
    setGoogleUsername,
  ] = useState("");

  const [
    selectedGoogleUsername,
    setSelectedGoogleUsername,
  ] = useState("");

  const [
    googleAccountEmail,
    setGoogleAccountEmail,
  ] = useState("");

  const [
    googlePassword,
    setGooglePassword,
  ] = useState("");

  const [
    googleConfirmPassword,
    setGoogleConfirmPassword,
  ] = useState("");

  const [
    googleHasExistingProfile,
    setGoogleHasExistingProfile,
  ] = useState(false);

  useEffect(() => {
    if (
      authLoading ||
      !authenticatedUser ||
      profileComplete ||
      profileError
    ) {
      return;
    }

    setGoogleAccountEmail(
      authenticatedUser.email ||
        ""
    );

    if (profile) {
      setGoogleHasExistingProfile(
        true
      );

      setGoogleStep(
        GOOGLE_STEPS.PASSWORD
      );

      return;
    }

    setGoogleHasExistingProfile(
      false
    );

    setGoogleStep(
      GOOGLE_STEPS.USERNAME
    );
  }, [
    authLoading,
    authenticatedUser,
    profile,
    profileComplete,
    profileError,
  ]);

  const resetGoogleSetupUi =
    () => {
      setGoogleStep(
        GOOGLE_STEPS.NONE
      );

      setGoogleUsername("");

      setSelectedGoogleUsername(
        ""
      );

      setGooglePassword("");

      setGoogleConfirmPassword(
        ""
      );

      setGoogleAccountEmail(
        ""
      );

      setGoogleHasExistingProfile(
        false
      );

      setError("");
    };

  const verifyProfileAndLogin =
    async () => {
      const refreshedProfile =
        await refreshProfile();

      if (!refreshedProfile) {
        throw new Error(
          "Your profile could not be verified. Please try again."
        );
      }

      resetGoogleSetupUi();

      onLogin();
    };

  const handleLogin =
    async (event) => {
      event.preventDefault();

      if (loading) {
        return;
      }

      setError("");

      if (
        !email.trim() ||
        !password
      ) {
        setError(
          "Please enter both email and password."
        );

        return;
      }

      if (
        !email.includes("@")
      ) {
        setError(
          "Please enter a valid email"
        );

        return;
      }

      setLoading(true);

      try {
        const result =
          await authService
            .login({
              email:
                email.trim(),
              password,
            });

        if (
          result.authenticated
        ) {
          onLogin();
        }
      } catch (loginError) {
        setError(
          loginError.message ||
            "Login Failed. Please try again."
        );
      } finally {
        setLoading(false);
      }
    };

  const handleGoogleLogin =
    async () => {
      if (loading) {
        return;
      }

      setError("");
      setLoading(true);

      try {
        const result =
          await authService
            .loginWithGoogle();

        if (
          result
            .needsExistingPasswordToLinkGoogle
        ) {
          setGoogleAccountEmail(
            result.email || ""
          );

          setGoogleStep(
            GOOGLE_STEPS
              .EXISTING_PASSWORD
          );

          return;
        }

        setGoogleAccountEmail(
          result.user?.email ||
            ""
        );

        if (
          result.authenticated &&
          result.needsUsernameSetup
        ) {
          setGoogleHasExistingProfile(
            false
          );

          setGoogleStep(
            GOOGLE_STEPS.USERNAME
          );

          return;
        }

        if (
          result.authenticated &&
          result.needsPasswordSetup
        ) {
          setGoogleHasExistingProfile(
            true
          );

          setGoogleStep(
            GOOGLE_STEPS.PASSWORD
          );

          return;
        }

        if (
          result.authenticated
        ) {
          onLogin();
        }
      } catch (loginError) {
        setError(
          loginError.message ||
            "Google login failed. Please try again."
        );
      } finally {
        setLoading(false);
      }
    };

  const handleGoogleUsernameSubmit =
    async (event) => {
      event.preventDefault();

      if (loading) {
        return;
      }

      const normalizedUsername =
        googleUsername.trim();

      setError("");

      if (
        !normalizedUsername
      ) {
        setError(
          "Please enter a username."
        );

        return;
      }

      setLoading(true);

      try {
        const result =
          await authService
            .prepareGoogleUsername(
              normalizedUsername
            );

        setSelectedGoogleUsername(
          result.username
        );

        setGoogleStep(
          GOOGLE_STEPS.PASSWORD
        );
      } catch (setupError) {
        setError(
          setupError.message ||
            "Username setup failed. Please try again."
        );
      } finally {
        setLoading(false);
      }
    };

  const handleGeneratedUsername =
    async () => {
      if (loading) {
        return;
      }

      setError("");
      setLoading(true);

      try {
        const result =
          await authService
            .prepareGeneratedGoogleUsername();

        setSelectedGoogleUsername(
          result.username
        );

        setGoogleStep(
          GOOGLE_STEPS.PASSWORD
        );
      } catch (setupError) {
        setError(
          setupError.message ||
            "Username setup failed. Please try again."
        );
      } finally {
        setLoading(false);
      }
    };

  const handleGooglePasswordSubmit =
    async (event) => {
      event.preventDefault();

      if (loading) {
        return;
      }

      setError("");

      if (
        !googlePassword ||
        !googleConfirmPassword
      ) {
        setError(
          "Password and confirmation are required."
        );

        return;
      }

      if (
        googlePassword !==
        googleConfirmPassword
      ) {
        setError(
          "Passwords do not match."
        );

        return;
      }

      setLoading(true);

      try {
        const result =
          googleHasExistingProfile
            ? await authService
                .completeGooglePasswordSetup(
                  {
                    password:
                      googlePassword,
                    confirmPassword:
                      googleConfirmPassword,
                  }
                )
            : await authService
                .completeGoogleRegistration(
                  {
                    password:
                      googlePassword,
                    confirmPassword:
                      googleConfirmPassword,
                  }
                );

        if (
          result.authenticated
        ) {
          await verifyProfileAndLogin();
        }
      } catch (setupError) {
        if (
          setupError.code ===
          "username-already-exists"
        ) {
          setGooglePassword(
            ""
          );

          setGoogleConfirmPassword(
            ""
          );

          setGoogleStep(
            GOOGLE_STEPS.USERNAME
          );
        }

        setError(
          setupError.message ||
            "Account setup failed. Please try again."
        );
      } finally {
        setLoading(false);
      }
    };

  const handleExistingPasswordLink =
    async (event) => {
      event.preventDefault();

      if (loading) {
        return;
      }

      setError("");

      if (!googlePassword) {
        setError(
          "Please enter your existing password."
        );

        return;
      }

      setLoading(true);

      try {
        const result =
          await authService
            .completeExistingPasswordGoogleLink(
              googlePassword
            );

        if (
          result.needsUsernameSetup
        ) {
          setGooglePassword(
            ""
          );

          setGoogleHasExistingProfile(
            false
          );

          setGoogleAccountEmail(
            result.user?.email ||
              googleAccountEmail
          );

          setGoogleStep(
            GOOGLE_STEPS.USERNAME
          );

          return;
        }

        if (
          result.authenticated
        ) {
          await verifyProfileAndLogin();
        }
      } catch (linkError) {
        setError(
          linkError.message ||
            "Google could not be linked to your existing account."
        );
      } finally {
        setLoading(false);
      }
    };

  const handleCancelGoogleSetup =
    async () => {
      if (loading) {
        return;
      }

      setError("");
      setLoading(true);

      try {
        await authService
          .cancelGoogleSetup();

        resetGoogleSetupUi();
      } catch (cancelError) {
        setError(
          cancelError.message ||
            "Account setup could not be canceled. Please try again."
        );
      } finally {
        setLoading(false);
      }
    };

  if (
    googleStep ===
    GOOGLE_STEPS.USERNAME
  ) {
    return (
      <AuthShell
        eyebrow="PROFILE SETUP"
        title="Choose your username"
        subtitle="Step 1 of 2. Choose how you want to appear throughout Interview Buddy."
      >
        {googleAccountEmail && (
          <p className="ib-auth-google-account">
            Signed in with{" "}
            <strong>
              {googleAccountEmail}
            </strong>
          </p>
        )}

        <form
          className="ib-auth-form"
          onSubmit={
            handleGoogleUsernameSubmit
          }
          noValidate
        >
          <div className="ib-auth-field">
            <label
              className="ib-label"
              htmlFor="ib-google-username"
            >
              Username
            </label>

            <input
              id="ib-google-username"
              className="ib-input ib-auth-input"
              type="text"
              placeholder="Choose a username"
              value={
                googleUsername
              }
              onChange={(
                event
              ) =>
                setGoogleUsername(
                  event.target
                    .value
                )
              }
              autoComplete="username"
              disabled={loading}
              autoFocus
              required
            />

            <p className="ib-auth-field-help">
              Your Firestore profile is
              not created until the
              required password step is
              complete.
            </p>
          </div>

          {error && (
            <p
              className="ib-auth-message ib-auth-message--error"
              role="alert"
            >
              {error}
            </p>
          )}

          <button
            className="ib-button ib-button--primary ib-auth-action"
            type="submit"
            disabled={loading}
          >
            {loading
              ? "Saving username..."
              : "Continue"}

            {!loading && (
              <span
                aria-hidden="true"
              >
                →
              </span>
            )}
          </button>

          <button
            className="ib-button ib-button--secondary ib-auth-action"
            type="button"
            onClick={
              handleGeneratedUsername
            }
            disabled={loading}
          >
            Skip - assign me a username
          </button>

          <button
            className="ib-auth-switch-button"
            type="button"
            onClick={
              handleCancelGoogleSetup
            }
            disabled={loading}
          >
            Cancel account creation
          </button>
        </form>
      </AuthShell>
    );
  }

  if (
    googleStep ===
    GOOGLE_STEPS.PASSWORD
  ) {
    return (
      <AuthShell
        eyebrow="SECURE YOUR ACCOUNT"
        title={
          googleHasExistingProfile
            ? "Add a password"
            : "Create your password"
        }
        subtitle={
          googleHasExistingProfile
            ? "Add a password so this same Interview Buddy account can use either Google or email and password."
            : "Step 2 of 2. A password is required before your Interview Buddy account is completed."
        }
      >
        {googleAccountEmail && (
          <p className="ib-auth-google-account">
            Account{" "}
            <strong>
              {googleAccountEmail}
            </strong>
          </p>
        )}

        {!googleHasExistingProfile &&
          selectedGoogleUsername && (
            <p className="ib-auth-google-account">
              Username{" "}
              <strong>
                {
                  selectedGoogleUsername
                }
              </strong>
            </p>
          )}

        <form
          className="ib-auth-form"
          onSubmit={
            handleGooglePasswordSubmit
          }
          noValidate
        >
          <div className="ib-auth-field">
            <label
              className="ib-label"
              htmlFor="ib-google-password"
            >
              Password
            </label>

            <input
              id="ib-google-password"
              className="ib-input ib-auth-input"
              type="password"
              placeholder="Create a password"
              value={
                googlePassword
              }
              onChange={(
                event
              ) =>
                setGooglePassword(
                  event.target
                    .value
                )
              }
              autoComplete="new-password"
              disabled={loading}
              autoFocus
              required
            />
          </div>

          <div className="ib-auth-field">
            <label
              className="ib-label"
              htmlFor="ib-google-confirm-password"
            >
              Confirm password
            </label>

            <input
              id="ib-google-confirm-password"
              className="ib-input ib-auth-input"
              type="password"
              placeholder="Confirm password"
              value={
                googleConfirmPassword
              }
              onChange={(
                event
              ) =>
                setGoogleConfirmPassword(
                  event.target
                    .value
                )
              }
              autoComplete="new-password"
              disabled={loading}
              required
            />

            <p className="ib-auth-field-help">
              This is your Interview
              Buddy password, not your
              Google password. Use at
              least 6 characters.
              Firebase may require a
              stronger password if a
              password policy is
              enabled.
            </p>
          </div>

          {error && (
            <p
              className="ib-auth-message ib-auth-message--error"
              role="alert"
            >
              {error}
            </p>
          )}

          <button
            className="ib-button ib-button--primary ib-auth-action"
            type="submit"
            disabled={loading}
          >
            {loading
              ? "Finishing setup..."
              : "Finish Account Setup"}

            {!loading && (
              <span
                aria-hidden="true"
              >
                →
              </span>
            )}
          </button>

          <button
            className="ib-button ib-button--secondary ib-auth-action"
            type="button"
            onClick={
              handleCancelGoogleSetup
            }
            disabled={loading}
          >
            {googleHasExistingProfile
              ? "Cancel and sign out"
              : "Cancel account creation"}
          </button>
        </form>
      </AuthShell>
    );
  }

  if (
    googleStep ===
    GOOGLE_STEPS.EXISTING_PASSWORD
  ) {
    return (
      <AuthShell
        eyebrow="LINK ACCOUNT"
        title="Confirm your existing account"
        subtitle="This email already belongs to an Interview Buddy account. Enter its existing password to link Google to the same account."
      >
        {googleAccountEmail && (
          <p className="ib-auth-google-account">
            Existing account{" "}
            <strong>
              {googleAccountEmail}
            </strong>
          </p>
        )}

        <form
          className="ib-auth-form"
          onSubmit={
            handleExistingPasswordLink
          }
          noValidate
        >
          <div className="ib-auth-field">
            <label
              className="ib-label"
              htmlFor="ib-existing-password"
            >
              Existing password
            </label>

            <input
              id="ib-existing-password"
              className="ib-input ib-auth-input"
              type="password"
              placeholder="Existing password"
              value={
                googlePassword
              }
              onChange={(
                event
              ) =>
                setGooglePassword(
                  event.target
                    .value
                )
              }
              autoComplete="current-password"
              disabled={loading}
              autoFocus
              required
            />
          </div>

          {error && (
            <p
              className="ib-auth-message ib-auth-message--error"
              role="alert"
            >
              {error}
            </p>
          )}

          <button
            className="ib-button ib-button--primary ib-auth-action"
            type="submit"
            disabled={loading}
          >
            {loading
              ? "Linking accounts..."
              : "Link Google Account"}
          </button>

          <button
            className="ib-button ib-button--secondary ib-auth-action"
            type="button"
            onClick={
              handleCancelGoogleSetup
            }
            disabled={loading}
          >
            Cancel
          </button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="ACCOUNT ACCESS"
      title="Welcome back"
      subtitle="Sign in to continue practicing and tracking your progress."
    >
      {loginMessage && (
        <p
          className="ib-auth-message ib-auth-message--success"
          role="status"
        >
          {loginMessage}
        </p>
      )}

      <form
        className="ib-auth-form"
        onSubmit={
          handleLogin
        }
        noValidate
      >
        <div className="ib-auth-field">
          <label
            className="ib-label"
            htmlFor="ib-login-email"
          >
            Email address
          </label>

          <input
            id="ib-login-email"
            className="ib-input ib-auth-input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(
              event
            ) =>
              setEmail(
                event.target
                  .value
              )
            }
            autoComplete="email"
            disabled={loading}
            required
          />
        </div>

        <div className="ib-auth-field">
          <div className="ib-auth-field-heading">
            <label
              className="ib-label"
              htmlFor="ib-login-password"
            >
              Password
            </label>

            <Link
              className="ib-auth-link"
              to={
                PAGES
                  .FORGOT_PASSWORD
              }
            >
              Forgot password?
            </Link>
          </div>

          <input
            id="ib-login-password"
            className="ib-input ib-auth-input"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(
              event
            ) =>
              setPassword(
                event.target
                  .value
              )
            }
            autoComplete="current-password"
            disabled={loading}
            required
          />
        </div>

        {error && (
          <p
            className="ib-auth-message ib-auth-message--error"
            role="alert"
          >
            {error}
          </p>
        )}

        <button
          className="ib-button ib-button--primary ib-auth-action"
          type="submit"
          disabled={loading}
        >
          {loading
            ? "Logging in..."
            : "Login to Workspace"}

          {!loading && (
            <span
              aria-hidden="true"
            >
              →
            </span>
          )}
        </button>
      </form>

      <div
        className="ib-auth-separator"
        aria-hidden="true"
      >
        <span>
          or continue with
        </span>
      </div>

      <button
        type="button"
        className="ib-button ib-button--secondary ib-auth-action ib-auth-google-button"
        onClick={
          handleGoogleLogin
        }
        disabled={loading}
      >
        <span
          className="ib-auth-google-symbol"
          aria-hidden="true"
        >
          G
        </span>

        Continue with Google
      </button>

      <p className="ib-auth-switch">
        New to Interview Buddy?{" "}
        <button
          type="button"
          className="ib-auth-switch-button"
          onClick={
            onGoToRegister
          }
          disabled={loading}
        >
          Create Account
        </button>
      </p>
    </AuthShell>
  );
}

export default LoginPage;