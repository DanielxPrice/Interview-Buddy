
import { auth } from "../config/firebase";

import {
  interviewService,
  INTERVIEW_MODES,
} from "./interviewService";

import { historyService } from "./historyService";
import { leaderboardService } from "./leaderboardService";
import { aiService } from "./aiService";

jest.mock("../config/firebase", () => ({
  auth: {
    currentUser: {
      getIdToken: jest.fn(),
    },
  },
}));

beforeEach(() => {
  auth.currentUser.getIdToken.mockResolvedValue("test-id-token");
});

const mockBackendSession = {
  id: "session-123",
  userId: "test-user",
  mode: "Quiz Style",
  jobRole: "Software Engineer",
  experienceLevel: "Intermediate",
  status: "active",
  createdAt: "2026-10-13T12:00:00.000Z",
  completedAt: null,
};

function mockSessionApiResponse(session = mockBackendSession) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 201,
    json: async () => session,
  });
}

describe("interviewService", () => {
  test("startSession preserves the selected question count", async () => {
    mockSessionApiResponse();

    const result =
      await interviewService.startSession({
        mode: INTERVIEW_MODES.QUIZ,
        jobRole: "Software Engineer",
        experienceLevel: "Intermediate",
        tags: [
          "algorithms",
          "data structures",
        ],
        questionCount: 20,
      });

    expect(
      result.questionCount
    ).toBe(20);

    expect(result.tags).toEqual([
      "algorithms",
      "data structures",
    ]);

    expect(
      result.practiceGoals
    ).toBe(
      "algorithms, data structures"
    );
  });

  test("getAvailableQuestionCount sends every selected tag and does not create a session", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ availableCount: 37 }),
    });
    const result = await interviewService.getAvailableQuestionCount({
      mode: INTERVIEW_MODES.QUIZ,
      jobRole: "Backend Developer",
      experienceLevel: "Beginner",
      tags: ["sql", "database", "rest api"],
    });
    expect(result).toBe(37);
    const [url, options] = global.fetch.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/api/questions/count");
    expect(parsed.searchParams.getAll("tags")).toEqual(["sql", "database", "rest api"]);
    expect(parsed.searchParams.get("jobRole")).toBe("Backend Developer");
    expect(options.headers.Authorization).toBe("Bearer test-id-token");
  });

  test("checkQuizAnswer sends the answer to its session persistence endpoint", async () => {
    const savedResult = {
      questionId: "quiz-1",
      isCorrect: true,
      explanation: "Correct.",
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => savedResult,
    });

    const result = await interviewService.checkQuizAnswer(
      "quiz-1",
      "A",
      "session-123"
    );

    expect(result).toEqual(savedResult);

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:5001/api/sessions/session-123/quiz-answers",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-id-token",
        },
        body: JSON.stringify({
          questionId: "quiz-1",
          answer: "A",
        }),
      }
    );
  });

  test("getAvailableQuestionCount rejects invalid server counts", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ availableCount: -1 }),
    });
    await expect(interviewService.getAvailableQuestionCount({
      mode: INTERVIEW_MODES.QUIZ, jobRole: "Software Engineer", experienceLevel: "Beginner", tags: ["sql"],
    })).rejects.toThrow("invalid available-question count");
  });

  test(
    "getQuestionQuota retrieves the current daily question allowance",
    async () => {
      global.fetch =
        jest.fn()
          .mockResolvedValue({
            ok: true,
            status: 200,

            json: async () => ({
              quota: {
                role: "user",

                unlimited: false,

                limit: 20,

                used: 7,

                remaining: 13,

                codeQuestionsUsed: 4,

                theoreticalQuestionsUsed: 3,

                dateKey:
                  "2026-10-09",

                timeZone:
                  "America/Los_Angeles",
              },
            }),
          });

      const result =
        await interviewService
          .getQuestionQuota();

      expect(
        global.fetch
      ).toHaveBeenCalledWith(
        "http://localhost:5001/api/questions/quota",
        {
          headers: {
            Authorization:
              "Bearer test-id-token",
          },
        }
      );

      expect(result).toEqual({
        role: "user",

        unlimited: false,

        limit: 20,

        used: 7,

        remaining: 13,

        codeQuestionsUsed: 4,

        theoreticalQuestionsUsed: 3,

        dateKey:
          "2026-10-09",

        timeZone:
          "America/Los_Angeles",
      });
    }
  );

  test(
    "getQuestions preserves daily quota error information",
    async () => {
      global.fetch =
        jest.fn()
          .mockResolvedValue({
            ok: false,
            status: 429,

            json: async () => ({
              error:
                "Daily AI question limit exceeded. 2 questions remain today.",

              code:
                "daily-question-limit-exceeded",

              quota: {
                limit: 20,
                used: 18,
                requested: 5,
                remaining: 2,
              },
            }),
          });

      let receivedError;

      try {
        await interviewService
          .getQuestions({
            mode:
              INTERVIEW_MODES.CODE,

            jobRole:
              "Software Engineer",

            experienceLevel:
              "Intermediate",

            tags: [
              "algorithms",
            ],

            limit: 5,
          });
      } catch (error) {
        receivedError =
          error;
      }

      expect(
        receivedError
      ).toBeDefined();

      expect(
        receivedError.code
      ).toBe(
        "daily-question-limit-exceeded"
      );

      expect(
        receivedError.status
      ).toBe(429);

      expect(
        receivedError.quota
      ).toEqual({
        limit: 20,
        used: 18,
        requested: 5,
        remaining: 2,
      });

      expect(
        receivedError.message
      ).toBe(
        "Daily AI question limit exceeded. 2 questions remain today."
      );
    }
  );

  test("startSession defaults to 10 questions when no count is provided", async () => {
    mockSessionApiResponse();
    const result =
      await interviewService.startSession({
        mode: INTERVIEW_MODES.QUIZ,
        jobRole: "Software Engineer",
        experienceLevel: "Intermediate",
        tags: ["algorithms"],
      });

    expect(
      result.questionCount
    ).toBe(10);
  });

  test.each([
    0,
    21,
    1.5,
  ])(
    "startSession rejects invalid question count %s",
    async (questionCount) => {
      await expect(
        interviewService.startSession({
          mode:
            INTERVIEW_MODES.QUIZ,
          jobRole:
            "Software Engineer",
          experienceLevel:
            "Intermediate",
          tags: ["algorithms"],
          questionCount,
        })
      ).rejects.toThrow(
        "Question count must be an integer between 1 and 20."
      );
    }
  );
  test("startSession creates an active Quiz Style session", async () => {
    mockSessionApiResponse();
    const result = await interviewService.startSession({
      mode: INTERVIEW_MODES.QUIZ,
      jobRole: "Software Engineer",
      experienceLevel: "Intermediate",
      tags: ["data structures"],
    });

    expect(result).toEqual(
      expect.objectContaining({
        mode: "Quiz Style",
        jobRole: "Software Engineer",
        experienceLevel: "Intermediate",
        tags: ["data structures"],
        codingLanguage: null,
        status: "active",
      })
    );

    expect(result.id).toBe("session-123");

    expect(result.createdAt).toBeDefined();
  });

  test("startSession supports Code Style and coding language", async () => {
    mockSessionApiResponse({
      ...mockBackendSession,
      mode: "Code Style",
    });
    const result = await interviewService.startSession({
      mode: INTERVIEW_MODES.CODE,
      jobRole: "Backend Developer",
      experienceLevel: "Experienced",
      tags: ["algorithms"],
      codingLanguage: "Java",
    });

    expect(result.mode).toBe("Code Style");
    expect(result.codingLanguage).toBe("Java");
  });

  test("startSession supports Theoretical Style", async () => {
    mockSessionApiResponse({
      ...mockBackendSession,
      mode: "Theoretical Style",
    });
    const result = await interviewService.startSession({
      mode: INTERVIEW_MODES.THEORETICAL,
      jobRole: "Software Engineer",
      experienceLevel: "Beginner",
      tags: ["computer science concepts"],
    });

    expect(result.mode).toBe("Theoretical Style");
    expect(result.status).toBe("active");
  });

  test("startSession rejects an invalid interview mode", async () => {
    await expect(
      interviewService.startSession({
        mode: "Invalid Mode",
        jobRole: "Developer",
        experienceLevel: "Beginner",
        tags: ["practice"],
      })
    ).rejects.toThrow("Invalid interview mode");
  });

  test("startSession requires all setup fields", async () => {
    await expect(
      interviewService.startSession({
        mode: INTERVIEW_MODES.QUIZ,
        jobRole: "",
        experienceLevel: "Beginner",
        tags: ["practice"],
      })
    ).rejects.toThrow(
      "Job role, experience level, and at least one tag are required."
    );
  });

  test("getSetupOptions reads mode metadata locally without a network request", async () => {
    global.fetch = jest.fn();

    const result = await interviewService.getSetupOptions(
      INTERVIEW_MODES.CODE,
      { jobRole: "software engineer", experienceLevel: "Beginner" }
    );

    expect(result.jobRoles).toContain("software engineer");
    expect(result.experienceLevels).toContain("Beginner");
    expect(result.tags.length).toBeGreaterThan(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("getQuestions sends selected tags and the frontend limit to the backend", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        questions: [{ id: "code-tree-1" }],
      }),
    });

    const result = await interviewService.getQuestions({
      mode: INTERVIEW_MODES.CODE,
      jobRole: "Software Engineer",
      experienceLevel: "Intermediate",
      tags: ["tree", "bfs"],
      limit: 10,
    });

    const requestUrl = global.fetch.mock.calls[0][0];
    const requestOptions = global.fetch.mock.calls[0][1];
    const url = new URL(requestUrl);

    expect(requestOptions).toEqual({
      headers: {
        Authorization: "Bearer test-id-token",
      },
    });

    expect(url.pathname).toBe("/api/questions");
    expect(url.searchParams.get("mode")).toBe("Code Style");
    expect(url.searchParams.get("jobRole")).toBe("Software Engineer");
    expect(url.searchParams.get("experienceLevel")).toBe("Intermediate");
    expect(url.searchParams.getAll("tags")).toEqual(["tree", "bfs"]);
    expect(url.searchParams.get("limit")).toBe("10");
    expect(result).toEqual([{ id: "code-tree-1" }]);
  });

  test("getQuestion requires a session ID", async () => {
    await expect(
      interviewService.getQuestion()
    ).rejects.toThrow("Session ID is required.");
  });

  test("submitAnswer accepts a valid answer", async () => {
    const result = await interviewService.submitAnswer(
      "session-1",
      "question-1",
      "My answer"
    );

    expect(result).toEqual({
      success: true,
      sessionId: "session-1",
      questionId: "question-1",
    });
  });

  test("submitAnswer rejects an empty answer", async () => {
    await expect(
      interviewService.submitAnswer(
        "session-1",
        "question-1",
        ""
      )
    ).rejects.toThrow("An answer is required.");
  });

  
  test("endSession returns a completed session", async () => {
    const completedSession = {
      id: "session-1",
      userId: "test-user",
      status: "completed",
      completedAt: "2026-10-13T12:30:00.000Z",
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => completedSession,
    });

    const result =
      await interviewService.endSession("session-1");

    expect(result.id).toBe("session-1");
    expect(result.status).toBe("completed");
    expect(result.completedAt).toBeDefined();

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:5001/api/sessions/session-1/complete",
      {
        method: "PATCH",
        headers: {
          Authorization: "Bearer test-id-token",
        },
      }
    );
  });
});

describe("historyService", () => {
  const completedSession = {
    id: "saved-1", mode: "Code Style", status: "completed",
    result: { score: 88, questionsAnswered: 4 },
  };

  test("getSessions uses authenticated completed-session API", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [completedSession] });
    const sessions = await historyService.getSessions();
    expect(sessions).toEqual([completedSession]);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:5001/api/sessions?status=completed",
      { headers: { Authorization: "Bearer test-id-token" } }
    );
  });

  test("getSessionPage retrieves bounded completed history with an opaque cursor", async () => {
    const page = { sessions: [completedSession], nextCursor: "saved-1" };
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => page });
    await expect(historyService.getSessionPage({ cursor: "prior-id", pageSize: 25 })).resolves.toEqual(page);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:5001/api/sessions?status=completed&pageSize=25&cursor=prior-id",
      { headers: { Authorization: "Bearer test-id-token" } }
    );
  });

  test("getSessionById retrieves an authorized saved session", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => completedSession });
    expect(await historyService.getSessionById("saved-1")).toEqual(completedSession);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:5001/api/sessions/saved-1",
      { headers: { Authorization: "Bearer test-id-token" } }
    );
  });

  test("getSessionById returns null for a missing session", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: "Session not found." }) });
    expect(await historyService.getSessionById("missing")).toBeNull();
  });

  test("getSessionById requires an ID", async () => {
    await expect(historyService.getSessionById()).rejects.toThrow("Session ID is required.");
  });

  test("rejects an unauthorized session", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
    await expect(historyService.getSessionById("another-user-session")).rejects.toThrow("permission");
  });

  test("does not falsely claim deletion is supported", async () => {
    await expect(historyService.deleteSession("saved-1")).rejects.toThrow("not supported");
  });
});

describe("leaderboardService", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  test("GET global leaderboard uses the Firebase token and sorts database records", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ rankings: [
        { uid: "two", username: "Second", rank: 2, elo: 1200 },
        { uid: "one", username: "First", rank: 1, elo: 1400 },
      ] }),
    });
    const result = await leaderboardService.getGlobalLeaderboard();
    expect(result.map((r) => r.username)).toEqual(["First", "Second"]);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:5001/api/leaderboard/global",
      { headers: { Authorization: "Bearer test-id-token" } }
    );
  });

  test("GET friends leaderboard accepts a real empty response", async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ rankings: [] }) });
    expect(await leaderboardService.getFriendsLeaderboard()).toEqual([]);
    expect(global.fetch.mock.calls[0][0]).toContain("/leaderboard/friends");
  });

  test("GET personal ranking uses the authenticated user's endpoint", async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ranking: null }) });
    expect(await leaderboardService.getUserRanking()).toBeNull();
    expect(global.fetch.mock.calls[0][0]).toContain("/leaderboard/me");
  });

  test("unimplemented endpoint signals unavailable instead of inventing data", async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    await expect(leaderboardService.getGlobalLeaderboard()).rejects.toMatchObject({ code: "feature-unavailable" });
    await expect(leaderboardService.getFriendsLeaderboard()).rejects.toMatchObject({ code: "feature-unavailable" });
    await expect(leaderboardService.getUserRanking()).rejects.toMatchObject({ code: "feature-unavailable" });
  });

  test("malformed successful data is rejected", async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: "oops" }) });
    await expect(leaderboardService.getGlobalLeaderboard()).rejects.toThrow("invalid leaderboard response");
  });

  test("missing Elo and rank stay unknown rather than appearing as zero", async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ rankings: [{ uid: "a", username: "Alex", rank: null, elo: null }] }) });
    expect(await leaderboardService.getGlobalLeaderboard()).toEqual([{ uid: "a", username: "Alex", rank: null, elo: null }]);
  });

  test("friend requests use authenticated POST and no local-only mutation", async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 202, json: async () => ({ status: "pending" }) });
    await leaderboardService.sendFriendRequest("Alex");
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:5001/api/friends/requests",
      { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer test-id-token" }, body: JSON.stringify({ username: "Alex" }) }
    );
  });

  test("removing a friend uses the database API and a stable ID", async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 204, json: async () => null });
    await leaderboardService.removeFriend("u/1");
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:5001/api/friends/u%2F1",
      { method: "DELETE", headers: { Authorization: "Bearer test-id-token" } }
    );
  });
});

describe("aiService", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("evaluateAnswer posts the public question id and candidate response", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        evaluation: {
          score: 85,
          feedback: "Good answer.",
          strengths: ["Accurate"],
          weaknesses: [],
          suggestions: ["Add an example"],
          criterionResults: [],
        },
      }),
    });

    const result = await aiService.evaluateAnswer({
      questionId: "theory-stack-queue-001",
      userAnswer: "A stack is LIFO and a queue is FIFO.",
      sessionId: "mock-session-1",
      jobRole: "Software Engineer",
      experienceLevel: "Intermediate",
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:5001/api/evaluate",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-id-token",
        },
      })
    );

    const request = global.fetch.mock.calls[0][1];
    const body = JSON.parse(request.body);
    expect(body.questionId).toBe("theory-stack-queue-001");
    expect(body.candidateResponse).toBe(
      "A stack is LIFO and a queue is FIFO."
    );
    expect(body).not.toHaveProperty("referenceAnswer");
    expect(body).not.toHaveProperty("gradingCriteria");
    expect(result.score).toBe(85);
  });

  test("evaluateAnswer requires a question id", async () => {
    await expect(
      aiService.evaluateAnswer({
        userAnswer: "User answer",
      })
    ).rejects.toThrow("Question ID is required.");
  });

  test("evaluateAnswer rejects an empty user answer", async () => {
    await expect(
      aiService.evaluateAnswer({
        questionId: "q1",
        userAnswer: "",
      })
    ).rejects.toThrow("User answer is required.");
  });

  test("evaluateAnswer surfaces backend errors", async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({
        error: "AI evaluation is not configured.",
      }),
    });

    await expect(
      aiService.evaluateAnswer({
        questionId: "q1",
        userAnswer: "Answer",
      })
    ).rejects.toThrow("AI evaluation is not configured.");
  });
});
