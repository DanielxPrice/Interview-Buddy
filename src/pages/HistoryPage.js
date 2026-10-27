import React, { useCallback, useEffect, useMemo, useState } from "react";
import PageLayout from "../components/layout/PageLayout";
import { PAGES } from "../utils/constants";
import { historyService } from "../services/historyService";
import { filterHistorySessions, normalizeHistorySession } from "../utils/historyResults";

const PAGE_SIZE = 8;

function ModeIcon({ mode }) {
  return (
    <span className={`ibHistoryIcon ${mode === "Code Style" ? "isCode" : mode === "Quiz Style" ? "isQuiz" : "isTheory"}`} aria-hidden="true">
      {mode === "Code Style" ? "</>" : mode === "Quiz Style" ? "?" : "◎"}
    </span>
  );
}

function HistoryPage({ currentPage, onNavigate, onSelectMode }) {
  const [sessions, setSessions] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState("all");
  const [score, setScore] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);

  const loadSessions = useCallback(async (isActive = () => true) => {
    setStatus("loading");
    setError("");
    try {
      const data = await historyService.getSessions();
      if (!isActive()) return;
      setSessions(data.map(normalizeHistorySession).sort((a, b) => (b.completedAt?.getTime() || 0) - (a.completedAt?.getTime() || 0)));
      setStatus("success");
    } catch (err) {
      if (!isActive()) return;
      setStatus("error");
      setError(err.message || "Unable to load your interview history.");
    }
  }, []);

  useEffect(() => {
    let active = true;
    loadSessions(() => active);
    return () => { active = false; };
  }, [loadSessions]);

  const filtered = useMemo(() => filterHistorySessions(sessions, { query: search, mode, score, from, to }), [sessions, search, mode, score, from, to]);
  const visible = filtered.slice(0, limit);
  const hasFilters = Boolean(search || mode !== "all" || score !== "all" || from || to);

  function resetFilters() {
    setSearch(""); setMode("all"); setScore("all"); setFrom(""); setTo(""); setLimit(PAGE_SIZE);
  }

  return (
    <PageLayout title="Interview History" subtitle="Track your progress and review previous interview results." currentPage={currentPage} onNavigate={onNavigate}>
      <section className="ibHistoryPage" aria-label="Completed interviews">
        <div className="ibHistoryToolbar">
          <label className="ibHistorySearch">
            <span className="ibVisuallyHidden">Search sessions by role, topic or mode</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></svg>
            <input value={search} onChange={(event) => { setSearch(event.target.value); setLimit(PAGE_SIZE); }} placeholder="Search sessions by role, topic or mode..." />
          </label>
          <label className="ibHistorySelect"><span className="ibVisuallyHidden">Filter interview mode</span><select value={mode} onChange={(event) => { setMode(event.target.value); setLimit(PAGE_SIZE); }}><option value="all">All Modes</option><option value="Code Style">Code Style</option><option value="Theoretical Style">Theoretical Style</option><option value="Quiz Style">Quiz Style</option></select></label>
          <label className="ibHistorySelect"><span className="ibVisuallyHidden">Filter session score</span><select value={score} onChange={(event) => { setScore(event.target.value); setLimit(PAGE_SIZE); }}><option value="all">Any Score</option><option value="high">80–100%</option><option value="medium">50–79%</option><option value="low">Below 50%</option></select></label>
          <div className="ibHistoryDates"><label>From <input aria-label="From date" type="date" value={from} max={to || undefined} onChange={(event) => { setFrom(event.target.value); setLimit(PAGE_SIZE); }}/></label><label>To <input aria-label="To date" type="date" value={to} min={from || undefined} onChange={(event) => { setTo(event.target.value); setLimit(PAGE_SIZE); }}/></label></div>
        </div>
        <div className="ibHistoryStatusBar">
          <span>{status === "success" ? `${filtered.length} completed ${filtered.length === 1 ? "session" : "sessions"}` : "Completed sessions"}</span>
          <div className="ibHistoryStatusActions">
            {hasFilters && <button type="button" onClick={resetFilters}>Clear filters</button>}
            <button type="button" onClick={() => { setLimit(PAGE_SIZE); loadSessions(); }} disabled={status === "loading"} aria-label="Refresh interview history">↻ Refresh</button>
          </div>
        </div>
        {status === "loading" && <div className="ibHistoryEmpty" role="status">Loading your completed interviews...</div>}
        {status === "error" && <div className="ibHistoryEmpty" role="alert"><h2>History could not be loaded</h2><p>{error}</p><button className="primaryButton" type="button" onClick={() => loadSessions()}>Try again</button></div>}
        {status === "success" && filtered.length === 0 && <div className="ibHistoryEmpty"><h2>{sessions.length ? "No matching sessions" : "No completed interviews yet"}</h2><p>{sessions.length ? "Try another search or filter." : "Finish a practice interview to see your results here."}</p>{hasFilters ? <button className="secondaryButton" type="button" onClick={resetFilters}>Clear filters</button> : <button className="primaryButton" type="button" onClick={() => onNavigate(PAGES.DASHBOARD)}>Start practicing</button>}</div>}
        {status === "success" && visible.length > 0 && <div className="ibHistoryList">
          {visible.map((session) => <article className="ibHistoryCard" key={session.id}>
            <ModeIcon mode={session.mode} />
            <div className="ibHistoryCardInfo"><div className="ibHistoryCardLabels"><time>{session.date.toUpperCase()}</time><span className="ibHistoryMode">{session.mode}</span></div><h2>{session.title}</h2><p>{[session.experienceLevel, session.tags.length ? session.tags.slice(0, 3).join(", ") : ""].filter(Boolean).join(" · ") || `Completed ${session.mode.toLowerCase()} session`}</p>{session.questionsAnswered != null && <span className="ibHistoryQuestions">{session.questionsAnswered} questions answered</span>}</div>
            <div className="ibHistoryMetrics"><div><span className="ibHistoryMetricLabel">SCORE</span><strong className={session.scoreValue !== null && session.scoreValue < 50 ? "ibHistoryScoreLow" : ""}>{session.score}</strong></div><div><span className="ibHistoryMetricLabel">ELO CHANGE</span><strong className="ibHistoryElo">{session.eloChange ?? "—"}</strong></div></div>
            <div className="ibHistoryActions"><button className="ibHistoryViewButton" type="button" onClick={() => onNavigate(`${PAGES.SESSION_RESULTS}/${encodeURIComponent(session.id)}`)}>View Results</button>{onSelectMode && <button className="ibHistoryRepeatButton" type="button" title="Start a new interview in this mode (configure your questions again)" aria-label={`Practice ${session.mode} again`} onClick={() => onSelectMode(session.mode)}>↻</button>}</div>
          </article>)}
        </div>}
        {status === "success" && visible.length < filtered.length && <div className="ibHistoryLoadMore"><button className="secondaryButton" type="button" onClick={() => setLimit((count) => count + PAGE_SIZE)}>Load Older Sessions <span aria-hidden="true">⌄</span></button></div>}
        {status === "success" && sessions.length > 0 && <p className="ibHistoryFootnote">History shows your saved session summaries. Detailed answers and AI feedback for older sessions require a backend results-retrieval endpoint. ELO is shown only when present in the saved record.</p>}
      </section>
    </PageLayout>
  );
}

export default HistoryPage;
