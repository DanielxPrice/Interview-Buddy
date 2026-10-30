
import {
  filterHistorySessions,
  normalizeHistorySession,
  parseSessionDate,
} from "./historyResults";

describe("saved session presentation", () => {
  const sample = {
    id: "test-1",
    mode: "Code Style",
    jobRole: "Backend Developer",
    experienceLevel: "Intermediate",
    status: "completed",

    result: {
      score: 92,
      questionsAnswered: 5,
    },

    completedAt: {
      _seconds: 1792600000,
      _nanoseconds: 0,
    },
  };

  test("handles serialized Firestore timestamps", () => {
    expect(
      parseSessionDate({
        seconds: 1792600000,
      }).toISOString()
    ).toBe(
      "2026-10-21T16:26:40.000Z"
    );

    expect(
      parseSessionDate("not a date")
    ).toBeNull();
  });

  test("uses saved data without making up ELO or question breakdown", () => {
    const normalized =
      normalizeHistorySession(sample);

    expect(normalized.score).toBe("92%");

    expect(normalized.title).toBe(
      "Backend Developer Interview"
    );

    expect(
      normalized.questionsAnswered
    ).toBe(5);

    expect(
      normalized.eloChange
    ).toBeNull();

    expect(
      normalized.perQuestion
    ).toEqual([]);

    expect(
      normalized.historicalSummary
    ).toBe(true);
  });

  test("preserves SEC-03 partial outcome across saved History refresh", () => {
    const normalized =
      normalizeHistorySession({
        ...sample,

        result: {
          score: 30,
          questionsAnswered: 1,
          questionsAssigned: 3,
          questionsUnanswered: 2,
          completionStatus: "partial",
          rankEligible: false,
        },

        // Old ELO values must not cause
        // partial practice to appear ranked.
        eloChange: "+2",
      });

    expect(normalized).toMatchObject({
      score: "30%",
      completionStatus: "partial",
      rankEligible: false,
      questionsAssigned: 3,
      questionsUnanswered: 2,
      eloChange: null,
    });
  });

  test("filters by text, mode, score and date", () => {
    const a =
      normalizeHistorySession(sample);

    const b =
      normalizeHistorySession({
        ...sample,

        id: "test-2",
        jobRole: "Frontend Engineer",
        mode: "Quiz Style",

        result: {
          score: 42,
        },
      });

    expect(
      filterHistorySessions(
        [a, b],
        {
          query: "backend",
          mode: "Code Style",
          score: "high",
        }
      )
    ).toEqual([a]);

    expect(
      filterHistorySessions(
        [a, b],
        {
          mode: "Quiz Style",
          score: "low",
        }
      )
    ).toEqual([b]);

    expect(
      filterHistorySessions(
        [a],
        {
          from: "2027-01-01",
        }
      )
    ).toEqual([]);
  });

  test("maps a saved breakdown without losing public feedback or estimated ELO", () => {
    const normalized =
      normalizeHistorySession({
        ...sample,

        result: {
          score: 90,
          questionsAnswered: 1,
          questionsAssigned: 1,
          questionsUnanswered: 0,
          completionStatus: "completed",
          rankEligible: true,
        },

        eloChange: "+2",
        breakdownAvailable: true,

        breakdown: [
          {
            questionId: "q1",
            questionPrompt: "Explain a queue",
            userAnswer: "FIFO",
            score: 90,
            feedback: "Correct",
            strengths: ["Concise"],

            criterionResults: [
              {
                name: "Correctness",
                awardedPoints: 45,
                maxPoints: 50,
              },
            ],
          },
        ],
      });

    expect(
      normalized.eloChange
    ).toBe("+2");

    expect(
      normalized.historicalSummary
    ).toBe(false);

    expect(
      normalized.perQuestion[0]
    ).toMatchObject({
      prompt: "Explain a queue",
      userAnswer: "FIFO",
      feedback: "Correct",
      strengths: ["Concise"],
    });
  });
});
