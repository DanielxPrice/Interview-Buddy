
import React, { useState } from "react";
import { Navigate } from "react-router-dom";

import AuthShell from "../auth/AuthShell";
import { useAuth } from "../../context/AuthContext";
import { emailVerificationService } from "../../services/emailVerificationService";
import { PAGES } from "../../utils/constants";

function EmailVerificationNotice({
  email,
  refreshProfile,
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function sendEmail() {
    setBusy(true);
    setMessage("");

    try {
      await emailVerificationService.send();

      setMessage(
        "Verification email sent. Check your inbox and spam folder."
      );
    } catch (error) {
      setMessage(
        error?.code === "auth/too-many-requests"
          ? "Too many requests. Try again later."
          : "Could not send a verification email. Try again later."
      );
    } finally {
      setBusy(false);
    }
  }

  async function checkEmail() {
    setBusy(true);
    setMessage("");

    try {
      const verified =
        await emailVerificationService.check();

      if (!verified) {
        setMessage(
          "Email not verified yet. Open the verification link first."
        );

        return;
      }

      await refreshProfile();
    } catch (_error) {
      setMessage(
        "Could not check verification. Try again."
      );
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setMessage("");

    try {
      await emailVerificationService.signOut();
    } catch (_error) {
      setMessage(
        "Unable to sign out. Please try again."
      );

      setBusy(false);
    }
  }

  return (
    <AuthShell
      eyebrow="ONE MORE STEP"
      title="Verify your email"
      subtitle="Confirm your email address to start practicing and tracking your progress."
    >
      <div className="ib-auth-verification-account">
        <span className="ib-auth-verification-icon" aria-hidden="true">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            focusable="false"
          >
            <rect x="3" y="5" width="18" height="14" rx="3" />
            <path d="m4 7 8 6 8-6" />
          </svg>
        </span>
        <div className="ib-auth-verification-address">
          <p className="ib-auth-field-help">Your account email</p>
          <p className="ib-auth-verification-email">
            {email || "The email address on your account"}
          </p>
        </div>
      </div>

      <div className="ib-auth-verification-actions">
        <p className="ib-help-text">
          Send a verification email, open the link in your inbox, then
          return here to continue.
        </p>

        <button
          className="ib-button ib-button--primary ib-auth-action"
          type="button"
          onClick={sendEmail}
          disabled={busy}
        >
          Send verification email
        </button>

        <button
          className="ib-button ib-button--secondary ib-auth-action"
          type="button"
          onClick={checkEmail}
          disabled={busy}
        >
          I've verified my email
        </button>

        {message && (
          <p className="ib-auth-message ib-auth-verification-message" role="status">
            {message}
          </p>
        )}
      </div>

      <div className="ib-auth-verification-help">
        <p className="ib-help-text">
          <strong>Can't find the email?</strong> Check your spam or junk
          folder, or try sending it again.
        </p>
        <p className="ib-auth-switch">
          Using a different account?{" "}
          <button
            className="ib-auth-switch-button"
            type="button"
            onClick={signOut}
            disabled={busy}
          >
            Sign out
          </button>
        </p>
      </div>
    </AuthShell>
  );
}

function ProtectedRoute({ children }) {
  const {
    user,
    loading,
    profileComplete,
    profileError,
    refreshProfile,
  } = useAuth();

  if (loading) {
    return <div>Loading...</div>;
  }

  if (!user) {
    return (
      <Navigate
        to={PAGES.LOGIN}
        replace
      />
    );
  }

  if (profileError) {
    return (
      <div
        role="alert"
        className="ib-page-message"
      >
        Unable to verify your Interview Buddy
        profile. Please refresh the page
        and try again.
      </div>
    );
  }

  // Keep the existing incomplete Google
  // onboarding and password-link workflow.
  if (!profileComplete) {
    return (
      <Navigate
        to={PAGES.LOGIN}
        replace
      />
    );
  }

  // Actual Firebase users expose emailVerified
  // as a boolean. Backend admission independently
  // requires a verified email.
  if (user.emailVerified === false) {
    return (
      <EmailVerificationNotice
        email={user.email}
        refreshProfile={refreshProfile}
      />
    );
  }

  return children;
}

export default ProtectedRoute;
