import React from "react";

import PageLayout from "../components/layout/PageLayout";
import PracticeModeCard from "../components/dashboard/PracticeModeCard";

import { useAuth } from "../context/AuthContext";
import { PAGES } from "../utils/constants";

function getUserDisplayName(user) {
  if (user?.displayName?.trim()) {
    return user.displayName.trim();
  }

  if (user?.email) {
    const emailName =
      user.email.split("@")[0];

    if (emailName) {
      return (
        emailName.charAt(0).toUpperCase() +
        emailName.slice(1)
      );
    }
  }

  return "there";
}

function DashboardPage({
  currentPage,
  onNavigate,
  onSelectMode,
}) {
  const { user } = useAuth();

  const displayName =
    getUserDisplayName(user);

  return (
    <PageLayout
      title="Dashboard"
      subtitle="Your technical interview practice workspace."
      currentPage={currentPage}
      onNavigate={onNavigate}
    >
      {/* Welcome section */}
      <section className="dashboardWelcome">
        <div>
          <span className="ib-eyebrow">
            Practice Workspace
          </span>

          <h2 className="dashboardWelcomeTitle">
            Welcome back, {displayName}!
          </h2>

          <p className="dashboardWelcomeText">
            Ready to sharpen your technical interview
            skills? Choose a training mode to get
            started.
          </p>
        </div>
      </section>

      {/* Interview mode selection */}
      <section
        className="dashboardPracticeSection"
        aria-labelledby="practiceModesTitle"
      >
        <div className="dashboardSectionHeader">
          <div>
            <h2 id="practiceModesTitle">
              Choose a Practice Mode
            </h2>

            <p>
              Each mode focuses on a different type
              of technical interview preparation.
            </p>
          </div>
        </div>

        <div className="dashboardPracticeGrid">
          <PracticeModeCard
            icon="▣"
            title="Quiz Style"
            description="Quick-fire multiple choice questions covering technical concepts and interview fundamentals."
            buttonLabel="Start Quiz"
            onOpen={() =>
              onSelectMode("Quiz Style")
            }
          />

          <PracticeModeCard
            icon="‹›"
            title="Code Style"
            description="Practice coding interview questions and explain your solution in a focused technical environment."
            buttonLabel="Start Coding"
            onOpen={() =>
              onSelectMode("Code Style")
            }
          />

          <PracticeModeCard
            icon="◎"
            title="Theoretical Style"
            description="Practice explaining technical concepts clearly through detailed written interview responses."
            buttonLabel="Start Review"
            onOpen={() =>
              onSelectMode(
                "Theoretical Style"
              )
            }
          />
        </div>
      </section>

      {/* Quick navigation */}
      <section
        className="dashboardQuickAccess"
        aria-label="Quick access"
      >
        <span className="dashboardQuickAccessLabel">
          QUICK ACCESS:
        </span>

        <button
          type="button"
          className="dashboardQuickAccessButton"
          onClick={() =>
            onNavigate(PAGES.HISTORY)
          }
        >
          History
        </button>

        <button
          type="button"
          className="dashboardQuickAccessButton"
          onClick={() =>
            onNavigate(PAGES.LEADERBOARD)
          }
        >
          Ranking
        </button>

        <button
          type="button"
          className="dashboardQuickAccessButton"
          onClick={() =>
            onNavigate(PAGES.ANALYTICS)
          }
        >
          Stats
        </button>

        <button
          type="button"
          className="dashboardQuickAccessButton"
          onClick={() =>
            onNavigate(PAGES.SETTINGS)
          }
        >
          Settings
        </button>
      </section>

      {/* Workflow overview */}
      <section className="dashboardOverviewCard ib-card">
        <div className="dashboardSectionHeader">
          <div>
            <span className="ib-eyebrow">
              Interview Workflow
            </span>

            <h2>
              Practice with a focused session
            </h2>

            <p>
              Interview Buddy guides you from
              configuration to real interview
              questions and response feedback.
            </p>
          </div>
        </div>

        <div className="dashboardSteps">
          <div className="dashboardStep">
            <span className="dashboardStepNumber">
              1
            </span>

            <div>
              <h3>Select a Mode</h3>
              <p>
                Choose Quiz, Code, or
                Theoretical practice.
              </p>
            </div>
          </div>

          <div className="dashboardStep">
            <span className="dashboardStepNumber">
              2
            </span>

            <div>
              <h3>Configure</h3>
              <p>
                Select your role, experience
                level, and practice goals.
              </p>
            </div>
          </div>

          <div className="dashboardStep">
            <span className="dashboardStepNumber">
              3
            </span>

            <div>
              <h3>Practice</h3>
              <p>
                Receive questions, submit your
                answers, and review feedback.
              </p>
            </div>
          </div>
        </div>
      </section>
    </PageLayout>
  );
}

export default DashboardPage;