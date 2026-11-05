
import React from "react";
import { Navigate } from "react-router-dom";

import EmailVerificationNotice from "../auth/EmailVerificationNotice";
import { useAuth } from "../../context/AuthContext";
import { PAGES } from "../../utils/constants";


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


  return children;
}

export default ProtectedRoute;
