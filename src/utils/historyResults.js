
// Display-only adapters for sessions returned by Express.

export function parseSessionDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : value;
  }

  if (typeof value === "object") {
    if (typeof value.toDate === "function") {
      return parseSessionDate(value.toDate());
    }

    const seconds =
      value.seconds ?? value._seconds;

    const nanoseconds =
      value.nanoseconds ?? value._nanoseconds ?? 0;

    if (Number.isFinite(Number(seconds))) {
      return parseSessionDate(
        new Date(
          Number(seconds) * 1000 +
          Number(nanoseconds) / 1e6
        )
      );
    }

    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? null
    : date;
}

export function getSessionScore(session) {
  const score =
    session?.result?.score ??
    session?.score;

  if (
    score === null ||
    score === undefined ||
    score === ""
  ) {
    return null;
  }

  const number =
    typeof score === "string"
      ? Number(score.replace(/%$/, ""))
      : Number(score);

  return Number.isFinite(number)
    ? number
    : null;
}

export function normalizeHistorySession(session) {
  const completedAt = parseSessionDate(
    session?.completedAt
  );

  const scoreValue =
    getSessionScore(session);

  const tags =
    Array.isArray(session?.tags)
      ? session.tags
      : [];

  const explicitElo =
    session?.result?.eloChange ??
    session?.eloChange;

  // The new /results endpoint can include
  // public question-level feedback.
  const hasBreakdown =
    Array.isArray(session?.breakdown) &&
    session?.breakdownAvailable !== false;

  const perQuestion = hasBreakdown
    ? session.breakdown.map((item) => ({
        questionId: item.questionId,

        prompt:
          item.questionPrompt || "",

        userAnswer:
          item.userAnswer || "",

        score: item.score,

        isCorrect:
          item.isCorrect,

        feedback:
          item.feedback || "",

        strengths:
          item.strengths || [],

        weaknesses:
          item.weaknesses || [],

        suggestions:
          item.suggestions || [],

        criterionResults:
          item.criterionResults || [],
      }))
    : [];

  const completionStatus =
    session?.result?.completionStatus ??
    session?.completionStatus ??
    null;

  const rankEligible =
    session?.result?.rankEligible ??
    session?.rankEligible ??
    null;

  return {
    id: session.id,
    sessionId: session.id,

    mode:
      session.mode || "Interview",

    title:
      session.title ||
      (session.jobRole
        ? `${session.jobRole} Interview`
        : `${session.mode || "Interview"} Practice`),

    jobRole:
      session.jobRole || "",

    experienceLevel:
      session.experienceLevel || "",

    tags,
    completedAt,

    date: completedAt
      ? completedAt.toLocaleDateString(
          "en-US",
          {
            month: "short",
            day: "numeric",
            year: "numeric",
          }
        )
      : "Date unavailable",

    scoreValue,

    score:
      scoreValue === null
        ? "Not available"
        : `${scoreValue}%`,

    questionsAnswered:
      session?.result?.questionsAnswered ??
      null,

    completionStatus,
    rankEligible,

    questionsAssigned:
      session?.result?.questionsAssigned ??
      null,

    questionsUnanswered:
      session?.result?.questionsUnanswered ??
      null,

    // Only fully completed ranked sessions
    // are allowed to display an ELO estimate.
    eloChange:
      rankEligible === true &&
      completionStatus === "completed" &&
      explicitElo !== null &&
      explicitElo !== undefined
        ? String(explicitElo)
        : null,

    perQuestion,

    breakdownAvailable:
      hasBreakdown,

    historicalSummary:
      !hasBreakdown,
  };
}

export function filterHistorySessions(
  sessions,
  {
    query = "",
    mode = "all",
    score = "all",
    from = "",
    to = "",
  } = {}
) {
  const search =
    query.trim().toLowerCase();

  const localDateKey = (date) =>
    date
      ? [
          date.getFullYear(),

          String(
            date.getMonth() + 1
          ).padStart(2, "0"),

          String(
            date.getDate()
          ).padStart(2, "0"),
        ].join("-")
      : null;

  return sessions.filter((session) => {
    const matchesText =
      !search ||
      [
        session.title,
        session.mode,
        session.jobRole,
        session.experienceLevel,
        ...session.tags,
      ].some((field) =>
        String(field || "")
          .toLowerCase()
          .includes(search)
      );

    const matchesMode =
      mode === "all" ||
      session.mode === mode;

    const points = session.scoreValue;

    const matchesScore =
      score === "all" ||
      (
        points !== null &&
        (
          (score === "high" &&
            points >= 80) ||

          (score === "medium" &&
            points >= 50 &&
            points < 80) ||

          (score === "low" &&
            points < 50)
        )
      );

    const day =
      localDateKey(
        session.completedAt
      );

    const matchesDate =
      (!from ||
        (day && day >= from)) &&
      (!to ||
        (day && day <= to));

    return (
      matchesText &&
      matchesMode &&
      matchesScore &&
      matchesDate
    );
  });
}
