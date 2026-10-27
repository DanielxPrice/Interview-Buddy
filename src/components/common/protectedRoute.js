
import React, { useState } from "react";
import { Navigate } from "react-router-dom";

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
    <main
      className="ib-page-message"
      aria-labelledby="email-verification-heading"
    >
      <h2 id="email-verification-heading">
        Verify your email
      </h2>

      <p>
        Confirm the email address{" "}
        {email || "on your account"} before
        accessing Interview Buddy practice features.
      </p>

      <button
        type="button"
        onClick={sendEmail}
        disabled={busy}
      >
        Send verification email
      </button>

      <button
        type="button"
        onClick={checkEmail}
        disabled={busy}
      >
        I've verified my email
      </button>

      <button
        type="button"
        onClick={signOut}
        disabled={busy}
      >
        Sign out
      </button>

      {message && (
        <p role="status">
          {message}
        </p>
      )}
    </main>
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
