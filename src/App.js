import React, {
  useEffect,
  useState,
} from "react";

import {
  useLocation,
  useNavigate,
} from "react-router-dom";

import "./App.css";

import { PAGES } from "./utils/constants";

import AppRoutes from "./utils/routes";
import { interviewService } from "./services/interviewService";

import { useAuth } from "./context/AuthContext";

function App() {
  const navigate = useNavigate();

  const location = useLocation();

  const {
    user,
    loading,
  } = useAuth();

  console.log(
    "Auth loading:",
    loading
  );

  console.log(
    "Current User:",
    user
  );

  const currentPage =
    location.pathname;

  const authenticatedUid = user?.uid;

  useEffect(() => {
    if (!authenticatedUid || loading) return undefined;
    const refresh = () => interviewService.refreshSetupMetadata().catch(() => {
      // Bundled metadata remains usable while Firestore/network is unavailable.
    });
    refresh();
    const timer = setInterval(refresh, 60000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      interviewService.resetMetadataVerification();
    };
  }, [authenticatedUid, loading]);

  const [
    selectedMode,
    setSelectedMode,
  ] = useState("");

  const [
    setupData,
    setSetupData,
  ] = useState({
    jobRole: "",
    experienceLevel: "",
    tags: [],
    practiceGoals: "",
    questionCount: 10,
  });

  const [
    sessionResult,
    setSessionResult,
  ] = useState({
    mode: "Quiz Style",
    date: "May 4, 2026",
    score: "0%",
    questionsAnswered: 0,
    eloChange: "0",
    isCorrect: null,
    answerSubmitted: false,
  });

  const [
    loginMessage,
    setLoginMessage,
  ] = useState("");

  useEffect(() => {
    if (
      currentPage !==
      PAGES.LOGIN
    ) {
      setLoginMessage("");
    }
  }, [currentPage]);

  function handleNavigate(path) {
    navigate(path);
  }

  function handleAccountDeleted() {
    setSessionResult({
      mode: "Quiz Style",
      date: "May 4, 2026",
      score: "0%",
      questionsAnswered: 0,
      eloChange: "0",
      isCorrect: null,
      answerSubmitted: false,
    });

    setSelectedMode("");

    setLoginMessage(
      "Your account has been successfully deleted."
    );

    navigate(
      PAGES.LOGIN,
      {
        replace: true,
      }
    );
  }

  function handleSelectMode(
    modeName
  ) {
    setSelectedMode(
      modeName
    );

    navigate(
      PAGES.INTERVIEW_SETUP
    );
  }

  function handleStartInterview(
    sessionData
  ) {
    setSetupData(
      sessionData
    );

    navigate(
      PAGES.INTERVIEW
    );
  }

  function handleEndInterview(
    resultData
  ) {
    setSessionResult(
      resultData
    );

    navigate(
      PAGES.SESSION_RESULTS
    );
  }

  return (
    <AppRoutes
      currentPage={
        currentPage
      }
      onNavigate={
        handleNavigate
      }
      onSelectMode={
        handleSelectMode
      }
      onStartInterview={
        handleStartInterview
      }
      onEndInterview={
        handleEndInterview
      }
      onAccountDeleted={
        handleAccountDeleted
      }
      loginMessage={
        loginMessage
      }
      selectedMode={
        selectedMode
      }
      setupData={
        setupData
      }
      sessionResult={
        sessionResult
      }
    />
  );
}

export default App;