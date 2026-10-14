jest.mock("../services/aiService", () => ({
  generateEvaluation: jest.fn(),
}));

const aiService = require("../services/aiService");
const createEvaluateRouter = require("./evaluate");

function getPostHandler(router) {
  const layer = router.stack.find(
    (entry) => entry.route && entry.route.path === "/" && entry.route.methods.post
  );
  return layer.route.stack[0].handle;
}

function createResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

const privateQuestion = {
  id: "theory-test-001",
  mode: "Theoretical Style",
  prompt: "Explain a test concept.",
  referenceAnswer: "Private reference answer.",
  gradingCriteria: [
    { name: "Accuracy", weight: 60, description: "Accurate." },
    { name: "Clarity", weight: 40, description: "Clear." },
  ],
  active: true,
};

describe("POST /api/evaluate route", () => {
  let questionRepository;
  let evaluationRepository;
  let sessionRepository;
  let router;
  let handler;

  beforeEach(() => {
    jest.clearAllMocks();
    questionRepository = {
      findById: jest.fn().mockResolvedValue(privateQuestion),
    };
    evaluationRepository = {
      saveEvaluation: jest.fn().mockResolvedValue(undefined),
    };
    sessionRepository = {
      findById: jest.fn().mockResolvedValue({
        id: "session-1",
        userId: "test-user",
        status: "active",
      }),
    };
    router = createEvaluateRouter({
      questionRepository,
      evaluationRepository,
      sessionRepository,
    });
    handler = getPostHandler(router);
  });

  it("loads the private question through the repository and delegates to aiService", async () => {
    const evaluation = {
      score: 90,
      feedback: "Strong answer.",
      strengths: ["Accurate"],
      weaknesses: [],
      suggestions: [],
      criterionResults: [],
    };
    aiService.generateEvaluation.mockResolvedValue(evaluation);

    const req = {
      user: { uid: "test-user" },
      body: {
        requestId: "request-1",
        questionId: privateQuestion.id,
        candidateResponse: "Candidate answer",
        metadata: {
          sessionId: "session-1",
          jobRole: "Software Engineer",
          experienceLevel: "Intermediate",
        },
      },
    };
    const res = createResponse();
    const next = jest.fn();

    await handler(req, res, next);

    expect(questionRepository.findById).toHaveBeenCalledWith(privateQuestion.id);
    expect(aiService.generateEvaluation).toHaveBeenCalledWith({
      question: privateQuestion,
      candidateResponse: "Candidate answer",
    });
    expect(evaluationRepository.saveEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        questionId: privateQuestion.id,
        candidateResponse: "Candidate answer",
        evaluation,
      })
    );
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({
      requestId: "request-1",
      questionId: privateQuestion.id,
      evaluation,
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects Quiz Style questions before calling the AI service", async () => {
    questionRepository.findById.mockResolvedValue({
      ...privateQuestion,
      mode: "Quiz Style",
    });

    const req = {
      body: {
        questionId: privateQuestion.id,
        candidateResponse: "Answer",
      },
    };
    const res = createResponse();
    const next = jest.fn();

    await handler(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.payload.error).toMatch(/Quiz Style/);
    expect(aiService.generateEvaluation).not.toHaveBeenCalled();
    expect(evaluationRepository.saveEvaluation).not.toHaveBeenCalled();
  });

  it("requires a question id and candidate response", async () => {
    const res = createResponse();
    await handler({ body: {} }, res, jest.fn());
    expect(res.statusCode).toBe(400);
    expect(res.payload.error).toBe("questionId is required.");
  });

  //Additional tests, check sessionId
  it("rejects evaluations for nonexistent sessions", async () => {
    sessionRepository.findById.mockResolvedValue(null);

    const req = {
      user: { uid: "test-user" },
      body: {
        questionId: privateQuestion.id,
        candidateResponse: "Candidate answer",
        metadata: {
          sessionId: "missing-session",
        },
      },
    };

    const res = createResponse();
    const next = jest.fn();

    await handler(req, res, next);

    expect(res.statusCode).toBe(404);

    expect(aiService.generateEvaluation).not.toHaveBeenCalled();

    expect(evaluationRepository.saveEvaluation).not.toHaveBeenCalled();

    expect(next).not.toHaveBeenCalled();
  });

  //Checks that the evaluation is rejected if the session belongs to another user
  it("rejects evaluations belonging to another user", async () => {
    sessionRepository.findById.mockResolvedValue({
      id: "session-1",
      userId: "another-user",
      status: "active",
    });

    const req = {
      user: { uid: "test-user" },
      body: {
        questionId: privateQuestion.id,
        candidateResponse: "Candidate answer",
        metadata: {
          sessionId: "session-1",
        },
      },
    };

    const res = createResponse();
    const next = jest.fn();

    await handler(req, res, next);

    expect(res.statusCode).toBe(403);

    expect(aiService.generateEvaluation).not.toHaveBeenCalled();

    expect(evaluationRepository.saveEvaluation).not.toHaveBeenCalled();

    expect(next).not.toHaveBeenCalled();
  });

  //Reject completed sessions
  it("rejects evaluations for completed sessions", async () => {
    sessionRepository.findById.mockResolvedValue({
      id: "session-1",
      userId: "test-user",
      status: "completed",
    });

    const req = {
      user: { uid: "test-user" },
      body: {
        questionId: privateQuestion.id,
        candidateResponse: "Candidate answer",
        metadata: {
          sessionId: "session-1",
        },
      },
    };

    const res = createResponse();
    const next = jest.fn();

    await handler(req, res, next);

    expect(res.statusCode).toBe(409);

    expect(aiService.generateEvaluation).not.toHaveBeenCalled();

    expect(evaluationRepository.saveEvaluation).not.toHaveBeenCalled();

    expect(next).not.toHaveBeenCalled();
  });

});
