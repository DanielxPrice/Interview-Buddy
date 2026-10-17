
import React, { useRef, useState } from "react";

import AuthShell from "../components/auth/AuthShell";
import { authService } from "../services/authService";

// Preserve the original username restriction.
const htmlTagPattern = /<[^>]*>/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getRegistrationErrorMessage(error) {
  switch (error?.code) {
    case "auth/email-already-in-use":
      return "An account with this email already exists.";

    case "auth/invalid-email":
      return "Please enter a valid email address.";

    case "auth/weak-password":
      return "Please choose a stronger password.";

    case "auth/network-request-failed":
      return "Unable to reach the authentication service. Please try again.";

    case "auth/too-many-requests":
      return "Too many registration attempts. Please try again later.";

    case "auth/profile-setup-failed":
    case "profile-creation-failed":
      return "We couldn't finish setting up your profile. Please try again.";

    case "auth/registration-rollback-failed":
      return "Your account may have been partially created. Please contact support before trying again.";

    case "auth/post-registration-signout-failed":
      return "Your account was created, but automatic sign-out failed. Please sign out before continuing.";

    default:
      return "Registration failed. Please try again.";
  }
}

function RegisterPage({ onRegister, onGoToLogin }) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Prevent multiple submissions before React updates loading.
  const submittingRef = useRef(false);

  const handleRegister = async (event) => {
    event.preventDefault();

    if (submittingRef.current) return;

    setError("");

    const normalizedUsername = username.trim();
    const normalizedEmail = email.trim();

    // Validate required fields.
    if (
      !normalizedUsername ||
      !normalizedEmail ||
      !password ||
      !confirmPassword
    ) {
      setError("Please complete all fields.");
      return;
    }

    // Preserve the original username validation.
    if (htmlTagPattern.test(normalizedUsername)) {
      setError("Username contains invalid characters.");
      return;
    }

    // Validate email format.
    if (!emailPattern.test(normalizedEmail)) {
      setError("Please enter a valid email address.");
      return;
    }

    // Firebase email/password authentication requires
    // a password of at least six characters.
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    // Confirm Password must match Password.
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    submittingRef.current = true;
    setLoading(true);

    try {
      // Keep the existing Firebase/profile registration flow.
      const result = await authService.register({
        username: normalizedUsername,
        email: normalizedEmail,
        password,
      });

      if (result?.created) {
        onRegister();
      } else {
        setError(
          "Registration could not be completed. Please try again."
        );
      }
    } catch (registrationError) {
      setError(
        getRegistrationErrorMessage(registrationError)
      );
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  return (
    <AuthShell
      eyebrow="GET STARTED"
      title="Create Account"
      subtitle="Join Interview Buddy and start preparing for your next interview."
    >
      <form
        className="ib-auth-form"
        onSubmit={handleRegister}
        noValidate
      >
        {/* Username */}
        <div className="ib-auth-field">
          <label
            className="ib-label"
            htmlFor="ib-register-username"
          >
            Username
          </label>

          <input
            id="ib-register-username"
            className="ib-input ib-auth-input"
            type="text"
            placeholder="Username"
            value={username}
            onChange={(event) =>
              setUsername(event.target.value)
            }
            autoComplete="username"
            disabled={loading}
            required
          />
        </div>

        {/* Email */}
        <div className="ib-auth-field">
          <label
            className="ib-label"
            htmlFor="ib-register-email"
          >
            Email address
          </label>

          <input
            id="ib-register-email"
            className="ib-input ib-auth-input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(event) =>
              setEmail(event.target.value)
            }
            autoComplete="email"
            disabled={loading}
            required
          />
        </div>

        {/* Password */}
        <div className="ib-auth-field">
          <label
            className="ib-label"
            htmlFor="ib-register-password"
          >
            Password
          </label>

          <input
            id="ib-register-password"
            className="ib-input ib-auth-input"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(event) =>
              setPassword(event.target.value)
            }
            autoComplete="new-password"
            aria-describedby="ib-register-password-help"
            disabled={loading}
            required
          />

          <p
            className="ib-help-text"
            id="ib-register-password-help"
          >
            Use at least 6 characters.
          </p>
        </div>

        {/* Confirm Password */}
        <div className="ib-auth-field">
          <label
            className="ib-label"
            htmlFor="ib-register-confirm-password"
          >
            Confirm Password
          </label>

          <input
            id="ib-register-confirm-password"
            className="ib-input ib-auth-input"
            type="password"
            placeholder="Confirm Password"
            value={confirmPassword}
            onChange={(event) =>
              setConfirmPassword(event.target.value)
            }
            autoComplete="new-password"
            disabled={loading}
            required
          />
        </div>

        {/* Validation / Firebase errors */}
        {error && (
          <p
            className="ib-auth-message ib-auth-message--error"
            role="alert"
          >
            {error}
          </p>
        )}

        {/* Primary registration action */}
        <button
          className="ib-button ib-button--primary ib-auth-action"
          type="submit"
          disabled={loading}
        >
          {loading ? "Creating account..." : "Create Account"}
          {!loading && (
            <span aria-hidden="true">→</span>
          )}
        </button>
      </form>

      {/* Return to existing Login page */}
      <p className="ib-auth-switch">
        Already have an account?{" "}
        <button
          type="button"
          className="ib-auth-switch-button"
          onClick={onGoToLogin}
          disabled={loading}
        >
          Back to Login
        </button>
      </p>
    </AuthShell>
  );
}

export default RegisterPage;
