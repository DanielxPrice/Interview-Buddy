import React, { useState, useEffect } from "react";
import PageLayout from "../components/layout/PageLayout";
import { PAGES } from "../utils/constants";
import { historyService } from "../services/historyService";
import StateRenderer from "../components/state/StateRenderer";

function HistoryPage({ currentPage, onNavigate }) {
  const [expandedId, setExpandedId] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  //Async function fetches sessions from the historyService.
  useEffect(() => {
    async function fetchSessions() {
      setStatus("loading");

      try {
        const data = await historyService.getSessions();

        setSessions(data);
        setStatus("success");
      } catch (err) {
        setError(err.message || "An error occurred while fetching sessions.");
        setStatus("error");
      }
    }

    fetchSessions();
  }, []);

  function toggleExpand(id) {
    setExpandedId(expandedId === id ? null : id);
  }

  return (
    <PageLayout
      title="Chat History"
      subtitle="Review and revisit your previous interview sessions."
      currentPage={currentPage}
      onNavigate={onNavigate}
    >
      <StateRenderer status={status} data={sessions} error={error} empty>
        <div className="historyList">
          {sessions.map((session) => (
            <div className="historyCard" key={session.id}>
              <div className="historyCardTop">
                <h2>{session.mode}</h2>
                <span className="historyScore">{session.score}</span>
              </div>

              <p className="historyMeta">Date: {session.date}</p>
              <p className="historyMeta">Questions Answered: {session.questionsAnswered}</p>
              <p className="historyMeta">ELO Change: {session.eloChange}</p>

              {expandedId === session.id && (
                <div className="sessionDetail">
                  <hr />
                  <h3>Session Summary</h3>
                  <p><strong>Mode:</strong> {session.mode}</p>
                  <p><strong>Date:</strong> {session.date}</p>
                  <p><strong>Score:</strong> {session.score}</p>
                  <p><strong>Questions Answered:</strong> {session.questionsAnswered}</p>
                  <p><strong>ELO Change:</strong> {session.eloChange}</p>
                  {session.summary && (
                    <p><strong>Notes:</strong> {session.summary}</p>
                  )}
                  <button
                    className="secondaryButton"
                    style={{ marginTop: "10px" }}
                    onClick={() => onNavigate(PAGES.INTERVIEW)}
                  >
                    Resume Session
                  </button>
                </div>
              )}

              <div className="actionRow">
                <button
                  className="secondaryButton"
                  onClick={() => toggleExpand(session.id)}
                >
                  {expandedId === session.id ? "Close" : "View"}
                </button>
                <button
                  className="secondaryButton"
                  onClick={() => onNavigate(PAGES.INTERVIEW)}
                >
                  Resume
                </button>
              </div>
            </div>
          ))}
        </div>
      </StateRenderer>
    </PageLayout>
  );
}

export default HistoryPage;