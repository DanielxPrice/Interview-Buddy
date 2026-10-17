import React, { useState } from "react";
import { Link } from "react-router-dom";

import { authService } from "../services/authService";
import { PAGES } from "../utils/constants";

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const handleResetPassword = async () => {
    setMessage("");
    setErrorMessage("");

    try {
      await authService.resetPassword(email);

      setMessage(
        "Password reset email sent. Check your inbox for the reset link."
      );
    } catch (error) {
      setErrorMessage(error.message);
    }
  };

  return (
    <div className="loginPage">
      <div className="loginCard">
        <div className="loginHeader">
          <h1 className="loginTitle">Reset Password</h1>

          <p className="loginSubtitle">
            Enter your email and we'll send you a password reset link.
          </p>
        </div>

        <div className="loginForm">
          <div className="inputGroup">
            <label className="inputLabel">Email</label>

            <input
              className="textInput"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          {message && (
            <p>
              {message}
            </p>
          )}

          {errorMessage && (
            <p>
              {errorMessage}
            </p>
          )}

          <button
            type="button"
            className="primaryButton"
            onClick={handleResetPassword}
          >
            Send Reset Link
          </button>

          <Link
            to={PAGES.LOGIN}
            className="forgotPasswordLink"
          >
            Back to Login
          </Link>
        </div>
      </div>
    </div>
  );
}

export default ForgotPasswordPage;