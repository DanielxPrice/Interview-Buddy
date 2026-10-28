
const express = require("express");
const request = require("supertest");

const createSessionRouter = require("./sessions");

function createApp({
  owner = "user-a",
  status = "completed",
  completionStatus = "completed",
  rankEligible = true,
} = {}) {
  const session = {
    id: "session-1",
    userId: owner,
    status,
    mode: "Theoretical Style",
    jobRole: "Backend Developer",
    experienceLevel: "Beginner",
    tags: ["trees"],

    completedAt:
      "2026-10-27T20:00:00.000Z",

    result: {
      score: 90,
      questionsAnswered: 1,
      questionsAssigned: 1,
      questionsUnanswered: 0,
      completionStatus,
      rankEligible,
    },
  };

  const sessionRepository = {
    findById: jest.fn().mockResolvedValue(
      session
    ),

    listResponses: jest.fn().mockResolvedValue([
      {
        questionId: "theory-1",
        questionPrompt: "Explain BFS",
        candidateResponse: "Use a queue",

        evaluation: {
          score: 90,
          feedback: "Good explanation",
          strengths: ["Clear answer"],
          weaknesses: ["Add complexity"],
          suggestions: ["Mention O(V + E)"],

          criterionResults: [
            {
              name: "Correctness",
              awardedPoints: 45,
              maxPoints: 50,
              feedback: "Correct concept",

              privatePrompt: "DO NOT SEND",
            },
          ],

          referenceAnswer: "DO NOT SEND",
          gradingCriteria: ["DO NOT SEND"],
        },

        referenceAnswer: "DO NOT SEND",
        gradingCriteria: ["DO NOT SEND"],
      },
    ]),

    finalizeSessionWithResults: jest.fn(),
  };

  const app = express();

  app.use((req, _res, next) => {
    req.user = {
      uid: "user-a",
    };

    next();
  });

  app.use(
    "/api/sessions",
    createSessionRouter({
      sessionRepository,
    })
  );

  app.use(
    (_error, _req, res, _next) =>
      res.status(500).json({
        error: "Internal error",
      })
  );

  return {
    app,
    sessionRepository,
  };
}

describe(
  "SEC-03 saved results and M09 response-code regression",
  () => {
    test("GET /sessions/:id returns a code for forbidden sessions", async () => {
      const { app } = createApp({
        owner: "user-b",
      });

      const response = await request(app)
        .get("/api/sessions/session-1");

      expect(response.status).toBe(403);

      expect(response.body.code).toBe(
        "SESSION_FORBIDDEN"
      );
    });

    test("saved results only expose authorized public feedback", async () => {
      const {
        app,
        sessionRepository,
      } = createApp();

      const response = await request(app)
        .get(
          "/api/sessions/session-1/results"
        );

      expect(response.status).toBe(200);
      expect(response.body.eloChange).toBe("+2");

      expect(
        response.body.breakdownAvailable
      ).toBe(true);

      expect(
        response.body.breakdown[0]
      ).toMatchObject({
        questionId: "theory-1",
        questionPrompt: "Explain BFS",
        userAnswer: "Use a queue",
        feedback: "Good explanation",
        strengths: ["Clear answer"],

        criterionResults: [
          expect.objectContaining({
            name: "Correctness",
          }),
        ],
      });

      // Private grading details must never
      // appear in the API response.
      expect(response.text).not.toContain(
        "DO NOT SEND"
      );

      expect(response.text).not.toContain(
        "referenceAnswer"
      );

      expect(response.text).not.toContain(
        "gradingCriteria"
      );

      // Reading results must not finalize again.
      expect(
        sessionRepository.finalizeSessionWithResults
      ).not.toHaveBeenCalled();

      expect(
        sessionRepository.listResponses
      ).toHaveBeenCalledTimes(1);
    });

    test("other users cannot read saved response details", async () => {
      const {
        app,
        sessionRepository,
      } = createApp({
        owner: "user-b",
      });

      const response = await request(app)
        .get(
          "/api/sessions/session-1/results"
        );

      expect(response.status).toBe(403);

      expect(response.body.code).toBe(
        "SESSION_FORBIDDEN"
      );

      expect(
        sessionRepository.listResponses
      ).not.toHaveBeenCalled();
    });

    test("partial sessions have no ELO estimate", async () => {
      const { app } = createApp({
        completionStatus: "partial",
        rankEligible: false,
      });

      const response = await request(app)
        .get(
          "/api/sessions/session-1/results"
        );

      expect(response.status).toBe(200);

      expect(
        response.body.eloChange
      ).toBeNull();
    });

    test("active sessions cannot be read through the completed-results API", async () => {
      const {
        app,
        sessionRepository,
      } = createApp({
        status: "active",
      });

      const response = await request(app)
        .get(
          "/api/sessions/session-1/results"
        );

      expect(response.status).toBe(409);

      expect(response.body.code).toBe(
        "SESSION_NOT_ACTIVE"
      );

      expect(
        sessionRepository.listResponses
      ).not.toHaveBeenCalled();
    });

    test("malformed session IDs are rejected before database access", async () => {
      const {
        app,
        sessionRepository,
      } = createApp();

      const response = await request(app)
        .get(
          "/api/sessions/invalid.id/results"
        );

      expect(response.status).toBe(400);

      expect(response.body.code).toBe(
        "INVALID_SESSION_ID"
      );

      expect(
        sessionRepository.findById
      ).not.toHaveBeenCalled();
    });
  }
);
