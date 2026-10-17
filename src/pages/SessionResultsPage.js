import React from "react";
import PageLayout from "../components/layout/PageLayout";
import FeedbackBox from "../components/interview/FeedbackBox";
import { PAGES } from "../utils/constants";

function SessionResultsPage({
  currentPage,
  onNavigate,
  sessionResult,
  onRetrySession,
}) {
  if (!sessionResult) {
    return (
      <PageLayout
        title="Session Results"
        subtitle="Unable to load session results."
        currentPage={currentPage}
        onNavigate={onNavigate}
      >
        <div className="resultSummaryCard">
          <p style={{ color: "#9f1c1c", marginBottom: "16px" }}>
            Unable to load session results. Please try again later.
          </p>
          <button
            className="primaryButton"
            onClick={() => onNavigate(PAGES.DASHBOARD)}
          >
            Return to Home
          </button>
        </div>
      </PageLayout>
    );
  }

  const mode = sessionResult.mode || "Interview Mode";
  const date = sessionResult.date || "Unknown date";
  const score = sessionResult.score || "0%";
  const eloChange = sessionResult.eloChange || "0";
  const breakdown = Array.isArray(sessionResult.perQuestion)
    ? sessionResult.perQuestion
    : [];
  const questionsAnswered =
    sessionResult.questionsAnswered != null
      ? sessionResult.questionsAnswered
      : breakdown.length;
  const analyticsAvailable = breakdown.length > 0;
  const aiFeedback = sessionResult.aiFeedback || "";
  const aiFeedbackAvailable = Boolean(aiFeedback.trim());

  function handleStartNewSession() {
    onNavigate(PAGES.DASHBOARD);
  }

  function handleReturnHome() {
    onNavigate(PAGES.DASHBOARD);
  }

  function handleRetrySession() {
    if (onRetrySession) {
      onRetrySession(sessionResult);
    } else {
      onNavigate(PAGES.INTERVIEW_SETUP);
    }
  }

  return (
    <PageLayout
      title="Session Results"
      subtitle="Detailed breakdown of your most recent practice session."
      currentPage={currentPage}
      onNavigate={onNavigate}
    >
      <div className="resultSummaryCard">
        <div className="resultSummaryTop">
          <h2>{mode}</h2>
          <span className="resultSummaryScore">{score}</span>
        </div>

        <p className="resultMeta">Date: {date}</p>
        <p className="resultMeta">Questions Attempted: {questionsAnswered}</p>
        <p className="resultMeta">ELO Change: {eloChange}</p>

        {sessionResult.feedbackMessage && (
          <FeedbackBox
            feedbackType={sessionResult.feedbackType}
            feedbackMessage={sessionResult.feedbackMessage}
          />
        )}
      </div>

      <div className="resultSummaryCard" style={{ marginTop: "20px" }}>
        <h2 style={{ color: "var(--text-primary)", marginBottom: "14px" }}>
          Per-Question Breakdown
        </h2>

        {!analyticsAvailable ? (
          <p style={{ color: "var(--text-secondary)" }}>
            No submitted question results are available for this session.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {breakdown.map((question, index) => {
              const isQuizResult = typeof question.isCorrect === "boolean";
              const resultLabel = isQuizResult
                ? question.isCorrect
                  ? "Correct"
                  : "Incorrect"
                : "AI evaluated";

              const resultColor = isQuizResult
                ? question.isCorrect
                  ? "#1f6b3d"
                  : "#9f1c1c"
                : "#0c4a6e";

              return (
                <div
                  key={question.questionId || index}
                  style={{
                    border: "2px solid #e5ebf2",
                    borderRadius: "12px",
                    padding: "14px 16px",
                    background: "#fbfcfe",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      gap: "10px",
                      marginBottom: "8px",
                    }}
                  >
                    <h3
                      style={{
                        fontSize: "1rem",
                        color: "#1f2937",
                        margin: 0,
                      }}
                    >
                      Question {index + 1}
                    </h3>
                    <span style={{ fontWeight: 700, color: resultColor }}>
                      {resultLabel}
                      {question.score != null && ` · ${question.score}%`}
                    </span>
                  </div>

                  <p style={{ color: "#2f3542", marginBottom: "8px" }}>
                    <strong>Prompt:</strong> {question.prompt}
                  </p>

                  {question.userAnswer && (
                    <p style={{ color: "#415064", marginBottom: "8px" }}>
                      <strong>Your answer:</strong> {question.userAnswer}
                    </p>
                  )}

                  {question.feedback && (
                    <p style={{ color: "#415064", marginBottom: "8px" }}>
                      <strong>Feedback:</strong> {question.feedback}
                    </p>
                  )}

                  {question.strengths?.length > 0 && (
                    <p style={{ color: "#415064", marginBottom: "6px" }}>
                      <strong>Strengths:</strong> {question.strengths.join("; ")}
                    </p>
                  )}

                  {question.weaknesses?.length > 0 && (
                    <p style={{ color: "#415064", marginBottom: "6px" }}>
                      <strong>Weaknesses:</strong> {question.weaknesses.join("; ")}
                    </p>
                  )}

                  {question.suggestions?.length > 0 && (
                    <p style={{ color: "#415064", marginBottom: "8px" }}>
                      <strong>Suggestions:</strong> {question.suggestions.join("; ")}
                    </p>
                  )}

                  {question.criterionResults?.length > 0 && (
                    <div style={{ marginTop: "10px" }}>
                      <strong style={{ color: "#2f3542" }}>Rubric:</strong>
                      <ul style={{ margin: "6px 0 0 20px", color: "#415064" }}>
                        {question.criterionResults.map((criterion) => (
                          <li key={criterion.name} style={{ marginBottom: "5px" }}>
                            {criterion.name}: {criterion.awardedPoints}/
                            {criterion.maxPoints} — {criterion.feedback}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {mode !== "Quiz Style" && (
        <div className="resultSummaryCard" style={{ marginTop: "20px" }}>
          <h2 style={{ color: "var(--text-primary)", marginBottom: "10px" }}>
            AI Feedback Summary
          </h2>
          {aiFeedbackAvailable ? (
            <div className="quizFeedback ai-feedback">
              <p style={{ whiteSpace: "pre-line" }}>{aiFeedback}</p>
            </div>
          ) : (
            <p style={{ color: "var(--text-secondary)", fontStyle: "italic" }}>
              No AI feedback was returned for this session.
            </p>
          )}
        </div>
      )}

      <div className="actionRow resultActionRow" style={{ gap: "10px" }}>
        <button className="primaryButton" onClick={handleStartNewSession}>
          Start new Session
        </button>
        <button className="secondaryButton" onClick={handleReturnHome}>
          Return to Home
        </button>
        <button className="secondaryButton" onClick={handleRetrySession}>
          Retry Session
        </button>
      </div>
    </PageLayout>
  );
}

export default SessionResultsPage;
