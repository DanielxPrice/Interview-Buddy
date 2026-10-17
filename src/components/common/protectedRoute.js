import React from "react";
import { Navigate } from "react-router-dom";

import { useAuth } from "../../context/AuthContext";
import { PAGES } from "../../utils/constants";

function ProtectedRoute({ children }) {
  const {
    user,
    loading,
    profileComplete,
    profileError,
  } = useAuth();

  // Always wait for authentication/profile
  // verification before deciding where to send
  // the user.
  if (loading) {
    return <div>Loading...</div>;
  }

  // Only redirect after authentication has
  // finished loading.
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
        profile. Please refresh the page and try
        again.
      </div>
    );
  }

  // Authenticated Firebase user, but no
  // Interview Buddy Firestore profile.
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