
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import PageLayout from "../components/layout/PageLayout";
import { PAGES } from "../utils/constants";
import { historyService } from "../services/historyService";
import { normalizeHistorySession } from "../utils/historyResults";

const COMPLETION_LABELS = {
  completed: "Fully completed",
  partial: "Ended early (partial practice)",
  abandoned: "Abandoned (no answers)",
};

function DetailsList({ title, items }) {
  if (!Array.isArray(items) || !items.length) {
    return null;
  }

  return (
    <div className="ibResultsFeedbackGroup">
      <h4>{title}</h4>

      <ul>
        {items.map((item, index) => (
          <li key={index}>
            {String(item)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SessionResultsPage({
  currentPage,
  onNavigate,
  onSelectMode,
  sessionResult,
}) {
  const { sessionId } = useParams();

  // Use in-memory details immediately after an interview.
  const currentResult =
    sessionResult &&
    (!sessionId ||
      (sessionResult.sessionId || sessionResult.id) ===
        sessionId)
      ? sessionResult
      : null;

  const [storedResult, setStoredResult] =
    useState(null);

  const [status, setStatus] = useState(
    currentResult ? "success" : "loading"
  );

  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (currentResult) {
      setStoredResult(currentResult);
      setStatus("success");
      setError("");
      return undefined;
    }

    if (!sessionId) {
      setStoredResult(null);
      setStatus("missing");
      return undefined;
    }

    let active = true;

    setStatus("loading");
    setError("");

    // SEC-03 M06:
    // Reload saved results AND public question feedback.
    historyService
      .getCompletedSessionResults(sessionId)
      .then((session) => {
        if (!active) return;

        if (
          !session ||
          session.status !== "completed"
        ) {
          setStoredResult(null);
          setStatus("missing");
          return;
        }

        setStoredResult(
          normalizeHistorySession(session)
        );

        setStatus("success");
      })
      .catch((err) => {
        if (!active) return;

        setStoredResult(null);

        setError(
          err.message ||
            "Unable to retrieve these results."
        );

        setStatus("error");
      });

    return () => {
      active = false;
    };
  }, [sessionId, currentResult, reloadKey]);

  const result = storedResult;

  const breakdown =
    Array.isArray(result?.perQuestion)
      ? result.perQuestion
      : [];

  const hasBreakdown =
    breakdown.length > 0;

  const savedSummary =
    result?.result || {};

  const completionStatus =
    result?.completionStatus ??
    savedSummary.completionStatus ??
    null;

  const rankEligible =
    result?.rankEligible ??
    savedSummary.rankEligible ??
    null;

  const assignedValue =
    result?.questionsAssigned ??
    savedSummary.questionsAssigned ??
    null;

  const questionsAssigned =
    Number.isInteger(assignedValue) &&
    assignedValue > 0
      ? assignedValue
      : null;

  const answeredValue =
    result?.questionsAnswered ??
    savedSummary.questionsAnswered ??
    null;

  const questionsAnswered =
    Number.isInteger(answeredValue) &&
    answeredValue >= 0
      ? answeredValue
      : hasBreakdown
        ? breakdown.length
        : null;

  const unansweredValue =
    result?.questionsUnanswered ??
    savedSummary.questionsUnanswered ??
    null;

  const questionsUnanswered =
    Number.isInteger(unansweredValue) &&
    unansweredValue >= 0
      ? unansweredValue
      : null;

  // Keep the server's result, including a valid 0%.
  const rawScore =
    result?.score ??
    savedSummary.score ??
    null;

  const score =
    typeof rawScore === "number" &&
    Number.isFinite(rawScore)
      ? `${rawScore}%`
      : rawScore ?? "Not available";

  const isHistorical =
    Boolean(result?.historicalSummary);

  const hasCompletionStatus =
    Object.prototype.hasOwnProperty.call(
      COMPLETION_LABELS,
      completionStatus
    );

  const completionLabel =
    hasCompletionStatus
      ? COMPLETION_LABELS[completionStatus]
      : null;

  const isFullCompletion =
    completionStatus === "completed";

  const isIncomplete =
    completionStatus === "partial" ||
    completionStatus === "abandoned";

  const isNotRanked =
    hasCompletionStatus &&
    (
      isIncomplete ||
      rankEligible === false
    );

  const isEligibleForElo =
    isFullCompletion &&
    rankEligible === true;

  const savedElo =
    result?.eloChange ??
    savedSummary.eloChange ??
    null;

  const hasEloEstimate =
    isEligibleForElo &&
    savedElo !== null &&
    savedElo !== undefined;

  const eloChange = hasEloEstimate
    ? savedElo
    : isNotRanked
      ? "Not ranked"
      : "—";

  const eloLabel =
    hasEloEstimate
      ? "Estimated ELO Change"
      : "ELO Change";

  const heroEyebrow =
    completionStatus === "completed"
      ? "INTERVIEW COMPLETED"
      : completionStatus === "partial"
        ? "INTERVIEW ENDED EARLY"
        : completionStatus === "abandoned"
          ? "INTERVIEW ABANDONED"
          : "COMPLETED INTERVIEW";

  return (
    <PageLayout
      title="Session Results"
      subtitle="Review your interview performance and feedback."
      currentPage={currentPage}
      onNavigate={onNavigate}
    >
      <div className="ibResultsPage">
        {status === "loading" && (
          <div
            className="ibResultsState"
            role="status"
          >
            Loading saved session results...
          </div>
        )}

        {status === "error" && (
          <div
            className="ibResultsState"
            role="alert"
          >
            <h2>Couldn't load these results</h2>
            <p>{error}</p>

            <div className="ibResultsStateActions">
              <button
                className="primaryButton"
                type="button"
                onClick={() =>
                  setReloadKey((key) => key + 1)
                }
              >
                Try again
              </button>

              <button
                className="secondaryButton"
                type="button"
                onClick={() =>
                  onNavigate(PAGES.HISTORY)
                }
              >
                Back to History
              </button>
            </div>
          </div>
        )}

        {status === "missing" && (
          <div className="ibResultsState">
            <h2>Results unavailable</h2>

            <p>
              This session could not be found,
              has not been completed, or no
              result was selected.
            </p>

            <button
              className="primaryButton"
              type="button"
              onClick={() =>
                onNavigate(PAGES.HISTORY)
              }
            >
              View Interview History
            </button>
          </div>
        )}

        {status === "success" && result && (
          <>
            <section
              className="ibResultsHero"
              aria-label="Session score summary"
            >
              <div className="ibResultsHeroMain">
                <span className="ibResultsEyebrow">
                  {heroEyebrow}
                </span>

                <h2>
                  {result.mode || "Interview"}
                </h2>

                <p>
                  {result.jobRole
                    ? `${result.jobRole}${
                        result.experienceLevel
                          ? ` · ${result.experienceLevel}`
                          : ""
                      }`
                    : "Your practice session results"}
                </p>

                <span className="ibResultsDate">
                  {result.date || "Date unavailable"}
                </span>
              </div>

              <div className="ibResultsScoreBubble">
                <span>
                  OVERALL SCORE
                </span>

                <strong>
                  {score}
                </strong>
              </div>
            </section>

            <div className="ibResultsStats">
              <div className="ibResultsStat">
                <span>
                  Interview Mode
                </span>

                <strong>
                  {result.mode || "—"}
                </strong>
              </div>

              <div className="ibResultsStat">
                <span>
                  Questions Answered
                </span>

                <strong>
                  {questionsAnswered ?? "—"}
                  {questionsAssigned !== null
                    ? ` / ${questionsAssigned}`
                    : ""}
                </strong>

                {questionsUnanswered !== null && (
                  <small>
                    {questionsUnanswered} unanswered
                  </small>
                )}
              </div>

              <div className="ibResultsStat">
                <span>
                  Session Outcome
                </span>

                <strong>
                  {completionLabel || "Legacy session"}
                </strong>
              </div>

              <div className="ibResultsStat">
                <span>
                  {eloLabel}
                </span>

                <strong>
                  {eloChange}
                </strong>

                {hasEloEstimate && (
                  <small>
                    Display estimate only; not a
                    confirmed ranking update.
                  </small>
                )}
              </div>
            </div>

            {isIncomplete && (
              <div
                className="ibResultsNotice"
                role="status"
              >
                {completionStatus === "partial"
                  ? "This interview ended before every assigned question was answered. Unanswered questions count as zero toward the overall score. This session is not eligible for ranking."
                  : "No questions were answered during this interview. The session has been saved as abandoned and is not eligible for ranking."}
              </div>
            )}

            {result.feedbackMessage && (
              <div className="ibResultsNotice">
                {result.feedbackMessage}
              </div>
            )}

            <section
              className="ibResultsPanel"
              aria-label="Question results"
            >
              <div className="ibResultsPanelHeading">
                <h2>
                  Per-Question Breakdown
                </h2>

                <span>
                  {hasBreakdown
                    ? `${breakdown.length} results`
                    : "Summary only"}
                </span>
              </div>

              {hasBreakdown ? (
                <div className="ibResultsQuestionList">
                  {breakdown.map((question, index) => {
                    const isQuiz =
                      result.mode === "Quiz Style" &&
                      typeof question.isCorrect ===
                        "boolean";

                    const isCorrect =
                      question.isCorrect === true;

                    const hasPoints =
                      question.score !== null &&
                      question.score !== undefined &&
                      Number.isFinite(
                        Number(question.score)
                      );

                    const points = hasPoints
                      ? `${question.score}%`
                      : null;

                    return (
                      <article
                        className="ibResultsQuestion"
                        key={`${
                          question.questionId ||
                          "question"
                        }-${index}`}
                      >
                        <div className="ibResultsQuestionTop">
                          <h3>
                            Question {index + 1}
                          </h3>

                          <div className="ibResultsQuestionBadges">
                            <span
                              className={`ibResultsOutcome ${
                                isQuiz
                                  ? isCorrect
                                    ? "isCorrect"
                                    : "isIncorrect"
                                  : "isEvaluated"
                              }`}
                            >
                              {isQuiz
                                ? isCorrect
                                  ? "Correct"
                                  : "Incorrect"
                                : "AI Evaluated"}
                            </span>

                            {points && (
                              <strong>
                                {points}
                              </strong>
                            )}
                          </div>
                        </div>

                        <p className="ibResultsPrompt">
                          {question.prompt ||
                            question.question ||
                            "Question prompt unavailable"}
                        </p>

                        {question.userAnswer && (
                          <div className="ibResultsAnswer">
                            <h4>
                              Your Answer
                            </h4>

                            <p>
                              {question.userAnswer}
                            </p>
                          </div>
                        )}

                        {question.feedback && (
                          <div className="ibResultsFeedbackGroup">
                            <h4>
                              Feedback
                            </h4>

                            <p>
                              {question.feedback}
                            </p>
                          </div>
                        )}

                        <div className="ibResultsFeedbackGrid">
                          <DetailsList
                            title="Strengths"
                            items={question.strengths}
                          />

                          <DetailsList
                            title="Areas to Improve"
                            items={question.weaknesses}
                          />

                          <DetailsList
                            title="Suggestions"
                            items={question.suggestions}
                          />
                        </div>

                        {Array.isArray(
                          question.criterionResults
                        ) &&
                          question.criterionResults.length >
                            0 && (
                            <div className="ibResultsFeedbackGroup">
                              <h4>
                                Evaluation Rubric
                              </h4>

                              <ul>
                                {question.criterionResults.map(
                                  (criterion, i) => (
                                    <li
                                      key={`${
                                        criterion.name ||
                                        "criterion"
                                      }-${i}`}
                                    >
                                      <strong>
                                        {criterion.name ||
                                          "Criterion"}
                                      </strong>
                                      :{" "}
                                      {criterion.awardedPoints ??
                                        "—"}
                                      /
                                      {criterion.maxPoints ??
                                        "—"}
                                      {criterion.feedback
                                        ? ` — ${criterion.feedback}`
                                        : ""}
                                    </li>
                                  )
                                )}
                              </ul>
                            </div>
                          )}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="ibResultsSummaryOnly">
                  <h3>
                    {completionStatus === "abandoned"
                      ? "No questions were answered"
                      : isHistorical
                        ? "This session's score is saved"
                        : "Detailed question results are unavailable"}
                  </h3>

                  <p>
                    {completionStatus === "abandoned"
                      ? "This session ended without any submitted answers."
                      : isHistorical
                        ? "The saved session contains its score and metadata, but question-level feedback is unavailable for this session."
                        : result.breakdownAvailable === false
                          ? "Your score was saved, but the question breakdown could not be loaded."
                          : "No question-level evaluations were provided for this session."}
                  </p>
                </div>
              )}
            </section>

            <div className="ibResultsActions">
              <button
                className="primaryButton"
                type="button"
                onClick={() =>
                  onNavigate(PAGES.HISTORY)
                }
              >
                View Interview History
              </button>

              <button
                className="secondaryButton"
                type="button"
                onClick={() =>
                  onNavigate(PAGES.DASHBOARD)
                }
              >
                Back to Dashboard
              </button>

              {onSelectMode &&
                result.mode &&
                [
                  "Code Style",
                  "Quiz Style",
                  "Theoretical Style",
                ].includes(result.mode) && (
                  <button
                    className="secondaryButton"
                    type="button"
                    onClick={() =>
                      onSelectMode(result.mode)
                    }
                  >
                    Practice Again
                  </button>
                )}
            </div>
          </>
        )}
      </div>
    </PageLayout>
  );
}

export default SessionResultsPage;
