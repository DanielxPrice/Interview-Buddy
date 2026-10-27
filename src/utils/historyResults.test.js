import { filterHistorySessions, normalizeHistorySession, parseSessionDate } from "./historyResults";

describe("saved session presentation", () => {
  const sample = {
    id: "test-1", mode: "Code Style", jobRole: "Backend Developer",
    experienceLevel: "Intermediate", status: "completed",
    result: { score: 92, questionsAnswered: 5 },
    completedAt: { _seconds: 1792600000, _nanoseconds: 0 },
  };

  test("handles serialized Firestore timestamps", () => {
    expect(parseSessionDate({ seconds: 1792600000 }).toISOString()).toBe("2026-10-21T16:26:40.000Z");
    expect(parseSessionDate("not a date")).toBeNull();
  });

  test("uses saved data without making up ELO or question breakdown", () => {
    const normalized = normalizeHistorySession(sample);
    expect(normalized.score).toBe("92%");
    expect(normalized.title).toBe("Backend Developer Interview");
    expect(normalized.questionsAnswered).toBe(5);
    expect(normalized.eloChange).toBeNull();
    expect(normalized.perQuestion).toEqual([]);
    expect(normalized.historicalSummary).toBe(true);
  });

  test("filters by text, mode, score and date", () => {
    const a = normalizeHistorySession(sample);
    const b = normalizeHistorySession({ ...sample, id: "test-2", jobRole: "Frontend Engineer", mode: "Quiz Style", result: { score: 42 } });
    expect(filterHistorySessions([a, b], { query: "backend", mode: "Code Style", score: "high" })).toEqual([a]);
    expect(filterHistorySessions([a, b], { mode: "Quiz Style", score: "low" })).toEqual([b]);
    expect(filterHistorySessions([a], { from: "2027-01-01" })).toEqual([]);
  });
});
