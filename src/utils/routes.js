import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { PAGES } from "./constants";
import ProtectedRoute from "../components/common/protectedRoute";

import LoginPage from "../pages/LoginPage";
import RegisterPage from "../pages/RegisterPage";
import DashboardPage from "../pages/DashboardPage";
import InterviewSetupPage from "../pages/InterviewSetupPage";
import InterviewSessionPage from "../pages/InterviewSessionPage";
import SessionResultsPage from "../pages/SessionResultsPage";
import SettingsPage from "../pages/SettingsPage";
import HistoryPage from "../pages/HistoryPage";
import LeaderboardPage from "../pages/LeaderboardPage";
import AnalyticsPage from "../pages/AnalyticsPage";
import ForgotPasswordPage from "../pages/ForgotPasswordPage";

function AppRoutes({
  currentPage,
  onNavigate,
  onSelectMode,
  onStartInterview,
  onEndInterview,
  onAccountDeleted,
  loginMessage,
  selectedMode,
  setupData,
  sessionResult,
}) {
  const commonProps = {
    currentPage,
    onNavigate,
  };

  return (
    <Routes>
      {/* Base URL redirects to login */}
      <Route
        path="/"
        element={<Navigate to={PAGES.LOGIN} replace />}
      />

      {/* Login */}
      <Route
        path={PAGES.LOGIN}
        element={
          <LoginPage
            onLogin={() => onNavigate(PAGES.DASHBOARD)}
            onGoToRegister={() => onNavigate(PAGES.REGISTER)}
            loginMessage={loginMessage}
          />
        }
      />

      {/* Forgot Password */}
      <Route
        path={PAGES.FORGOT_PASSWORD}
        element={<ForgotPasswordPage />}
      />

      {/* Register */}
      <Route
        path={PAGES.REGISTER}
        element={
          <RegisterPage
            onRegister={() => onNavigate(PAGES.LOGIN)}
            onGoToLogin={() => onNavigate(PAGES.LOGIN)}
          />
        }
      />

      {/* Dashboard */}
      <Route
        path={PAGES.DASHBOARD}
        element={
          <ProtectedRoute>

          <DashboardPage
            {...commonProps}
            onSelectMode={onSelectMode}
            />
          </ProtectedRoute>
        }
      />

      {/* Interview Setup */}
      <Route
        path={PAGES.INTERVIEW_SETUP}
        element={
          <ProtectedRoute>
            <InterviewSetupPage
              {...commonProps}
              selectedMode={selectedMode}
              onStartInterview={onStartInterview}
            />
          </ProtectedRoute>
        }
      />

      {/* Active Interview Session */}
      <Route
        path={PAGES.INTERVIEW}
        element={
          <ProtectedRoute>
            <InterviewSessionPage
              {...commonProps}
              selectedMode={selectedMode}
              setupData={setupData}
              onEndInterview={onEndInterview}
            />
          </ProtectedRoute>
        }
      />

      {/* Session Results */}
      <Route
        path={PAGES.SESSION_RESULTS}
        element={
          <ProtectedRoute>
            <SessionResultsPage
              {...commonProps}
              sessionResult={sessionResult}
            />
          </ProtectedRoute>
        }
      />

      {/* History */}
      <Route
        path={PAGES.HISTORY}
        element={
          <ProtectedRoute>
            <HistoryPage {...commonProps} />
          </ProtectedRoute>
        }
      />

      {/* Leaderboard */}
      <Route
        path={PAGES.LEADERBOARD}
        element={
          <ProtectedRoute>
            <LeaderboardPage {...commonProps} />
          </ProtectedRoute>
        }
      />

      {/* Analytics */}
      <Route
        path={PAGES.ANALYTICS}
        element={
          <ProtectedRoute>
            <AnalyticsPage {...commonProps} />
          </ProtectedRoute>
        }
      />

      {/* Settings */}
      <Route
        path={PAGES.SETTINGS}
        element={
          <ProtectedRoute>
            <SettingsPage
              {...commonProps}
              onAccountDeleted={onAccountDeleted}
            />
          </ProtectedRoute>
        }
      />

      
      {/* Legacy password URL redirects to Settings */}
      <Route
        path={PAGES.CHANGE_PASSWORD}
        element={
          <ProtectedRoute>
            <Navigate to={PAGES.SETTINGS} replace />
          </ProtectedRoute>
        }
      />


      {/* Temporary fallback until we add the 404 page */}
      <Route
        path="*"
        element={<Navigate to={PAGES.DASHBOARD} replace />}
      />
    </Routes>
  );
}

export default AppRoutes;