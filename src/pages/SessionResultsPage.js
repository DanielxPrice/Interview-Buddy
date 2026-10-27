import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import PageLayout from "../components/layout/PageLayout";
import { PAGES } from "../utils/constants";
import { historyService } from "../services/historyService";
import { normalizeHistorySession } from "../utils/historyResults";

function DetailsList({ title, items }) {
  if (!Array.isArray(items) || !items.length) return null;
  return <div className="ibResultsFeedbackGroup"><h4>{title}</h4><ul>{items.map((item, index) => <li key={index}>{String(item)}</li>)}</ul></div>;
}

function SessionResultsPage({ currentPage, onNavigate, onSelectMode, sessionResult }) {
  const { sessionId } = useParams();
  const currentResult = sessionResult && (!sessionId || sessionResult.sessionId === sessionId)
    ? sessionResult : null;
  const [storedResult, setStoredResult] = useState(null);
  const [status, setStatus] = useState(currentResult ? "success" : "loading");
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    // Fresh completions include the detailed breakdown that the existing
    // GET /sessions/:id endpoint cannot provide on a later page refresh.
    if (currentResult) {
      setStoredResult(currentResult);
      setStatus("success");
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
    historyService.getSessionById(sessionId).then((session) => {
      if (!active) return;
      if (!session || session.status !== "completed") {
        setStatus("missing");
        setStoredResult(null);
      } else {
        setStoredResult(normalizeHistorySession(session));
        setStatus("success");
      }
    }).catch((err) => {
      if (!active) return;
      setError(err.message || "Unable to retrieve these results.");
      setStatus("error");
    });
    return () => { active = false; };
  }, [sessionId, currentResult, reloadKey]);

  const result = storedResult;
  const breakdown = Array.isArray(result?.perQuestion) ? result.perQuestion : [];
  const hasBreakdown = breakdown.length > 0;
  const score = result?.score ?? "Not available";
  const isHistorical = Boolean(result?.historicalSummary);
  const isEstimatedElo = !isHistorical && result?.eloChange !== undefined && result?.eloChange !== null;

  return (
    <PageLayout title="Session Results" subtitle="Review your interview performance and feedback." currentPage={currentPage} onNavigate={onNavigate}>
      <div className="ibResultsPage">
        {status === "loading" && <div className="ibResultsState" role="status">Loading saved session results...</div>}
        {status === "error" && <div className="ibResultsState" role="alert"><h2>Couldn't load these results</h2><p>{error}</p><div className="ibResultsStateActions"><button className="primaryButton" type="button" onClick={() => setReloadKey((key) => key + 1)}>Try again</button><button className="secondaryButton" type="button" onClick={() => onNavigate(PAGES.HISTORY)}>Back to History</button></div></div>}
        {status === "missing" && <div className="ibResultsState"><h2>Results unavailable</h2><p>This session could not be found, has not been completed, or no result was selected.</p><button className="primaryButton" type="button" onClick={() => onNavigate(PAGES.HISTORY)}>View Interview History</button></div>}
        {status === "success" && result && <>
          <section className="ibResultsHero" aria-label="Session score summary">
            <div className="ibResultsHeroMain">
              <span className="ibResultsEyebrow">COMPLETED INTERVIEW</span>
              <h2>{result.mode || "Interview"}</h2>
              <p>{result.jobRole ? `${result.jobRole}${result.experienceLevel ? ` · ${result.experienceLevel}` : ""}` : "Your practice session results"}</p>
              <span className="ibResultsDate">{result.date || "Date unavailable"}</span>
            </div>
            <div className="ibResultsScoreBubble"><span>OVERALL SCORE</span><strong>{score}</strong></div>
          </section>
          <div className="ibResultsStats">
            <div className="ibResultsStat"><span>Interview Mode</span><strong>{result.mode || "—"}</strong></div>
            <div className="ibResultsStat"><span>Questions Answered</span><strong>{result.questionsAnswered ?? (hasBreakdown ? breakdown.length : "—")}</strong></div>
            <div className="ibResultsStat"><span>{isEstimatedElo ? "Estimated ELO Change" : "Saved ELO Change"}</span><strong>{result.eloChange ?? "—"}</strong>{isEstimatedElo && <small>Estimate only; not a confirmed ranking update.</small>}</div>
          </div>
          {result.feedbackMessage && <div className="ibResultsNotice">{result.feedbackMessage}</div>}
          <section className="ibResultsPanel" aria-label="Question results">
            <div className="ibResultsPanelHeading"><h2>Per-Question Breakdown</h2><span>{hasBreakdown ? `${breakdown.length} results` : "Summary only"}</span></div>
            {hasBreakdown ? <div className="ibResultsQuestionList">
              {breakdown.map((question, index) => {
                const isQuiz = result.mode === "Quiz Style" && typeof question.isCorrect === "boolean";
                const isCorrect = question.isCorrect === true;
                const points = Number.isFinite(Number(question.score)) && question.score !== null && question.score !== undefined ? `${question.score}%` : null;
                return <article className="ibResultsQuestion" key={`${question.questionId || "question"}-${index}`}>
                  <div className="ibResultsQuestionTop"><h3>Question {index + 1}</h3><div className="ibResultsQuestionBadges"><span className={`ibResultsOutcome ${isQuiz ? (isCorrect ? "isCorrect" : "isIncorrect") : "isEvaluated"}`}>{isQuiz ? (isCorrect ? "Correct" : "Incorrect") : "AI Evaluated"}</span>{points && <strong>{points}</strong>}</div></div>
                  <p className="ibResultsPrompt">{question.prompt || question.question || "Question prompt unavailable"}</p>
                  {question.userAnswer && <div className="ibResultsAnswer"><h4>Your Answer</h4><p>{question.userAnswer}</p></div>}
                  {question.feedback && <div className="ibResultsFeedbackGroup"><h4>Feedback</h4><p>{question.feedback}</p></div>}
                  <div className="ibResultsFeedbackGrid"><DetailsList title="Strengths" items={question.strengths}/><DetailsList title="Areas to Improve" items={question.weaknesses}/><DetailsList title="Suggestions" items={question.suggestions}/></div>
                  {Array.isArray(question.criterionResults) && question.criterionResults.length > 0 && <div className="ibResultsFeedbackGroup"><h4>Evaluation Rubric</h4><ul>{question.criterionResults.map((criterion, i) => <li key={`${criterion.name || "criterion"}-${i}`}><strong>{criterion.name || "Criterion"}</strong>: {criterion.awardedPoints ?? "—"}/{criterion.maxPoints ?? "—"}{criterion.feedback ? ` — ${criterion.feedback}` : ""}</li>)}</ul></div>}
                </article>;
              })}
            </div> : <div className="ibResultsSummaryOnly"><h3>{isHistorical ? "This session's score is saved" : "Detailed question results are unavailable"}</h3><p>{isHistorical ? "The existing backend returns this completed session's score and metadata, but does not yet expose its saved question answers or AI feedback for review. Those details appear directly after an interview when available." : result.breakdownAvailable === false ? "Your score was saved, but the question breakdown could not be loaded." : "No question-level evaluations were provided for this session."}</p></div>}
          </section>
          <div className="ibResultsActions"><button className="primaryButton" type="button" onClick={() => onNavigate(PAGES.HISTORY)}>View Interview History</button><button className="secondaryButton" type="button" onClick={() => onNavigate(PAGES.DASHBOARD)}>Back to Dashboard</button>{onSelectMode && result.mode && ["Code Style", "Quiz Style", "Theoretical Style"].includes(result.mode) && <button className="secondaryButton" type="button" onClick={() => onSelectMode(result.mode)}>Practice Again</button>}</div>
        </>}
      </div>
    </PageLayout>
  );
}

export default SessionResultsPage;
