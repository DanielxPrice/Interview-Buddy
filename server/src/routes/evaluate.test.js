
jest.mock("../services/aiService", () => ({
  generateEvaluation: jest.fn(),
}));

const aiService = require("../services/aiService");
const createEvaluateRouter = require("./evaluate");

const QUESTION_ID = "theory-test-001";
const SESSION_ID = "session-1";
const USER_ID = "test-user";

const privateQuestion = {
  id: QUESTION_ID,
  mode: "Theoretical Style",
  prompt: "Explain a test concept.",
  referenceAnswer: "Private reference answer.",
  gradingCriteria: [
    { name: "Accuracy", weight: 60, description: "Accurate." },
    { name: "Clarity", weight: 40, description: "Clear." },
  ],
  active: true,
};

const successfulEvaluation = {
  score: 90,
  feedback: "Strong answer.",
  strengths: ["Accurate"],
  weaknesses: [],
  suggestions: [],
  criterionResults: [],
};

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

function createTestContext(body = {}) {
  return {
    req: {
      user: { uid: USER_ID },
      body,
    },
    res: createResponse(),
    next: jest.fn(),
  };
}

describe("POST /api/evaluate route", () => {
  let questionRepository;
  let evaluationRepository;
  let sessionRepository;
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
        id: SESSION_ID,
        userId: USER_ID,
        status: "active",
      }),
    };

    const router = createEvaluateRouter({
      questionRepository,
      evaluationRepository,
      sessionRepository,
    });

    handler = getPostHandler(router);

    aiService.generateEvaluation.mockResolvedValue(successfulEvaluation);
  });

  async function submit(body) {
    const context = createTestContext(body);
    await handler(context.req, context.res, context.next);
    return context;
  }

  it("evaluates a private question and saves an authorized session response", async () => {
    const { res, next } = await submit({
      requestId: "request-1",
      questionId: QUESTION_ID,
      candidateResponse: "Candidate answer",
      metadata: {
        sessionId: SESSION_ID,
        jobRole: "Software Engineer",
        experienceLevel: "Intermediate",
      },
    });

    expect(questionRepository.findById).toHaveBeenCalledWith(QUESTION_ID);
    expect(sessionRepository.findById).toHaveBeenCalledWith(SESSION_ID);

    expect(aiService.generateEvaluation).toHaveBeenCalledWith({
      question: privateQuestion,
      candidateResponse: "Candidate answer",
    });

    expect(evaluationRepository.saveEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: SESSION_ID,
        questionId: QUESTION_ID,
        candidateResponse: "Candidate answer",
        evaluation: successfulEvaluation,
      })
    );

    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({
      requestId: "request-1",
      questionId: QUESTION_ID,
      evaluation: successfulEvaluation,
    });
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    ["one below the limit", 9999],
    ["exactly at the limit", 10000],
  ])("accepts a response %s (%i characters)", async (_, length) => {
    const candidateResponse = "a".repeat(length);

    const { res, next } = await submit({
      questionId: QUESTION_ID,
      candidateResponse,
    });

    expect(res.statusCode).toBe(200);
    expect(aiService.generateEvaluation).toHaveBeenCalledWith({
      question: privateQuestion,
      candidateResponse,
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a response above the 10000-character limit", async () => {
    const { res, next } = await submit({
      questionId: QUESTION_ID,
      candidateResponse: "a".repeat(10001),
    });

    expect(res.statusCode).toBe(400);
    expect(res.payload.error).toMatch(/maximum length/i);
    expect(res.payload.code).toBe("CANDIDATE_RESPONSE_TOO_LONG");
    expect(questionRepository.findById).not.toHaveBeenCalled();
    expect(aiService.generateEvaluation).not.toHaveBeenCalled();
    expect(evaluationRepository.saveEvaluation).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    ["object", { text: "My answer" }],
    ["array", ["My answer"]],
    ["number", 123],
    ["boolean", true],
  ])("rejects a %s candidate response", async (_, candidateResponse) => {
    const { res, next } = await submit({
      questionId: QUESTION_ID,
      candidateResponse,
    });

    expect(res.statusCode).toBe(400);
    expect(res.payload.code).toBe("CANDIDATE_RESPONSE_REQUIRED");
    expect(questionRepository.findById).not.toHaveBeenCalled();
    expect(aiService.generateEvaluation).not.toHaveBeenCalled();
    expect(evaluationRepository.saveEvaluation).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a missing question ID", async () => {
    const { res, next } = await submit({
      candidateResponse: "My answer",
    });

    expect(res.statusCode).toBe(400);
    expect(res.payload.error).toBe("questionId is required.");
    expect(res.payload.code).toBe("QUESTION_NOT_FOUND");
    expect(questionRepository.findById).not.toHaveBeenCalled();
    expect(aiService.generateEvaluation).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "   \n\t "])(
    "rejects a missing or blank candidate response: %p",
    async (candidateResponse) => {
      const { res, next } = await submit({
        questionId: QUESTION_ID,
        candidateResponse,
        metadata: { sessionId: SESSION_ID },
      });

      expect(res.statusCode).toBe(400);
      expect(res.payload.error).toBe("candidateResponse is required.");
      expect(res.payload.code).toBe("CANDIDATE_RESPONSE_REQUIRED");
      expect(questionRepository.findById).not.toHaveBeenCalled();
      expect(aiService.generateEvaluation).not.toHaveBeenCalled();
      expect(evaluationRepository.saveEvaluation).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    }
  );

  it("returns 404 when the question does not exist", async () => {
    questionRepository.findById.mockResolvedValue(null);

    const { res, next } = await submit({
      questionId: "missing-question",
      candidateResponse: "My answer",
    });

    expect(res.statusCode).toBe(404);
    expect(res.payload.error).toBe("Question not found.");
    expect(res.payload.code).toBe("QUESTION_NOT_FOUND");
    expect(aiService.generateEvaluation).not.toHaveBeenCalled();
    expect(evaluationRepository.saveEvaluation).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects inactive questions", async () => {
    questionRepository.findById.mockResolvedValue({
      ...privateQuestion,
      active: false,
    });

    const { res, next } = await submit({
      questionId: QUESTION_ID,
      candidateResponse: "My answer",
    });

    expect(res.statusCode).toBe(409);
    expect(res.payload.error).toBe("This question is inactive.");
    expect(res.payload.code).toBe("QUESTION_INACTIVE");
    expect(aiService.generateEvaluation).not.toHaveBeenCalled();
    expect(evaluationRepository.saveEvaluation).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects Quiz Style before calling AI", async () => {
    questionRepository.findById.mockResolvedValue({
      ...privateQuestion,
      mode: "Quiz Style",
    });

    const { res, next } = await submit({
      questionId: QUESTION_ID,
      candidateResponse: "My answer",
    });

    expect(res.statusCode).toBe(400);
    expect(res.payload.error).toMatch(/Quiz Style/);
    expect(res.payload.code).toBe("UNSUPPORTED_EVALUATION_MODE");
    expect(aiService.generateEvaluation).not.toHaveBeenCalled();
    expect(evaluationRepository.saveEvaluation).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects evaluations for nonexistent sessions", async () => {
    sessionRepository.findById.mockResolvedValue(null);

    const { res, next } = await submit({
      questionId: QUESTION_ID,
      candidateResponse: "My answer",
      metadata: { sessionId: "missing-session" },
    });

    expect(res.statusCode).toBe(404);
    expect(aiService.generateEvaluation).not.toHaveBeenCalled();
    expect(evaluationRepository.saveEvaluation).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects evaluations for another user's session", async () => {
    sessionRepository.findById.mockResolvedValue({
      id: SESSION_ID,
      userId: "another-user",
      status: "active",
    });

    const { res, next } = await submit({
      questionId: QUESTION_ID,
      candidateResponse: "My answer",
      metadata: { sessionId: SESSION_ID },
    });

    expect(res.statusCode).toBe(403);
    expect(aiService.generateEvaluation).not.toHaveBeenCalled();
    expect(evaluationRepository.saveEvaluation).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects evaluations for completed sessions", async () => {
    sessionRepository.findById.mockResolvedValue({
      id: SESSION_ID,
      userId: USER_ID,
      status: "completed",
    });

    const { res, next } = await submit({
      questionId: QUESTION_ID,
      candidateResponse: "My answer",
      metadata: { sessionId: SESSION_ID },
    });

    expect(res.statusCode).toBe(409);
    expect(aiService.generateEvaluation).not.toHaveBeenCalled();
    expect(evaluationRepository.saveEvaluation).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("passes Firestore persistence failures to the error handler", async () => {
    const databaseError = new Error("Firestore write failed.");
    evaluationRepository.saveEvaluation.mockRejectedValue(databaseError);

    const { res, next } = await submit({
      questionId: QUESTION_ID,
      candidateResponse: "My answer",
      metadata: { sessionId: SESSION_ID },
    });

    expect(aiService.generateEvaluation).toHaveBeenCalledTimes(1);
    expect(evaluationRepository.saveEvaluation).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(databaseError);
    expect(res.payload).toBeNull();
  });

  it("does not persist an evaluation when AI fails", async () => {
    const aiError = new Error("AI evaluation unavailable.");
    aiError.statusCode = 503;
    aiService.generateEvaluation.mockRejectedValue(aiError);

    const { res, next } = await submit({
      requestId: "request-failed",
      questionId: QUESTION_ID,
      candidateResponse: "My answer",
      metadata: { sessionId: SESSION_ID },
    });

    expect(res.statusCode).toBe(503);
    expect(res.payload).toEqual({
      error: "AI evaluation unavailable.",
      requestId: "request-failed",
    });
    expect(evaluationRepository.saveEvaluation).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("does not return raw private grading fields", async () => {
    const { res, next } = await submit({
      requestId: "reference-test",
      questionId: QUESTION_ID,
      candidateResponse: "My explanation.",
      metadata: { sessionId: SESSION_ID },
    });

    expect(res.statusCode).toBe(200);
    expect(aiService.generateEvaluation).toHaveBeenCalledWith({
      question: privateQuestion,
      candidateResponse: "My explanation.",
    });

    expect(res.payload).toEqual({
      requestId: "reference-test",
      questionId: QUESTION_ID,
      evaluation: successfulEvaluation,
    });

    expect(res.payload).not.toHaveProperty("referenceAnswer");
    expect(res.payload).not.toHaveProperty("gradingCriteria");
    expect(next).not.toHaveBeenCalled();
  });
  
  
it.each([
  ["null", null],
  ["a string", "invalid"],
  ["an array", []],
  ["a number", 123],
])(
  "rejects metadata supplied as %s",
  async (_, metadata) => {
    const { req, res, next } = createTestContext({
      questionId: privateQuestion.id,
      candidateResponse: "My answer",
      metadata,
    });

    await handler(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.payload.code).toBe("METADATA_INVALID");
    expect(questionRepository.findById).not.toHaveBeenCalled();
    expect(aiService.generateEvaluation).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  }
);

it.each([
  ["sessionId", 123],
  ["jobRole", {}],
  ["experienceLevel", []],
])(
  "rejects an invalid %s metadata field",
  async (field, value) => {
    const { req, res, next } = createTestContext({
      questionId: privateQuestion.id,
      candidateResponse: "My answer",
      metadata: {
        sessionId: "session-1",
        jobRole: "Software Engineer",
        experienceLevel: "Intermediate",
        [field]: value,
      },
    });

    await handler(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.payload.code).toBe("METADATA_FIELD_INVALID");
    expect(questionRepository.findById).not.toHaveBeenCalled();
    expect(aiService.generateEvaluation).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  }
);



});
