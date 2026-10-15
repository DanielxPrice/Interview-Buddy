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

function createTestContext(body = {}) {
  return {
    req: { body },
    res: createResponse(),
    next: jest.fn(),
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
    router = createEvaluateRouter({
      questionRepository,
      evaluationRepository,
    });
    handler = getPostHandler(router);
  });


it.each([
  ["one below the limit", 9999],
  ["exactly at the limit", 10000],
])(
  "accepts a candidate response %s (%i characters)",
  async (_, length) => {
    const candidateResponse = "a".repeat(length);

    aiService.generateEvaluation.mockResolvedValue({
      score: 90,
      feedback: "Good answer.",
      strengths: [],
      weaknesses: [],
      suggestions: [],
      criterionResults: [],
    });

    const { req, res, next } = createTestContext({
      questionId: privateQuestion.id,
      candidateResponse,
    });

    await handler(req, res, next);

    expect(res.statusCode).toBe(200);
    expect(aiService.generateEvaluation).toHaveBeenCalledWith({
      question: privateQuestion,
      candidateResponse,
    });
    expect(next).not.toHaveBeenCalled();
  }
);

it("rejects a candidate response one character over the limit", async () => {
  const candidateResponse = "a".repeat(10001);

  const { req, res, next } = createTestContext({
    questionId: privateQuestion.id,
    candidateResponse,
  });

  await handler(req, res, next);

  expect(res.statusCode).toBe(400);
  expect(res.payload.error).toMatch(/maximum length/i);
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
])("rejects a candidate response supplied as a %s", async (_, answer) => {
  const {req, res, next } = createTestContext({
    questionId: privateQuestion.id,
    candidateResponse: answer,
  });

  await handler(req, res, next);

  expect(res.statusCode).toBe(400);
  expect(aiService.generateEvaluation).not.toHaveBeenCalled();
  expect(next).not.toHaveBeenCalled();
 }

);



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
    expect(next).not.toHaveBeenCalled();
  });

  
  it("rejects a missing question ID without calling dependencies", async () => {
    const res = createResponse();

    await handler(
      { body: { candidateResponse: "My answer" } },
      res,
      jest.fn()
    );

    expect(res.statusCode).toBe(400);
    expect(res.payload.error).toBe("questionId is required.");
    expect(res.payload.code).toBe("QUESTION_NOT_FOUND");
    expect(questionRepository.findById).not.toHaveBeenCalled();
    expect(aiService.generateEvaluation).not.toHaveBeenCalled();
  });

  it("rejects an empty candidate response", async () => {
    const res = createResponse();

    await handler(
      {
        body: {
          questionId: privateQuestion.id,
          candidateResponse: "",
        },
      },
      res,
      jest.fn()
    );

    expect(res.statusCode).toBe(400);
    expect(res.payload.error).toBe("candidateResponse is required.");
    expect(res.payload.code).toBe("CANDIDATE_RESPONSE_REQUIRED");
    expect(questionRepository.findById).not.toHaveBeenCalled();
    expect(aiService.generateEvaluation).not.toHaveBeenCalled();
  });

  it("rejects a whitespace-only candidate response", async () => {
    const res = createResponse();

    await handler(
      {
        body: {
          questionId: privateQuestion.id,
          candidateResponse: "   \n\t ",
        },
      },
      res,
      jest.fn()
    );

    expect(res.statusCode).toBe(400);
    expect(aiService.generateEvaluation).not.toHaveBeenCalled();
  });

  it("returns 404 when the question does not exist", async () => {
    questionRepository.findById.mockResolvedValue(null);

    const res = createResponse();

    await handler(
      {
        body: {
          questionId: "nonexistent-question",
          candidateResponse: "My answer",
        },
      },
      res,
      jest.fn()
    );

    expect(res.statusCode).toBe(404);
    expect(res.payload.error).toBe("Question not found.");
    expect(res.payload.code).toBe("QUESTION_NOT_FOUND");
    expect(aiService.generateEvaluation).not.toHaveBeenCalled();
    expect(evaluationRepository.saveEvaluation).not.toHaveBeenCalled();
  });

  it("rejects inactive questions before AI evaluation", async () => {
    questionRepository.findById.mockResolvedValue({
      ...privateQuestion,
      active: false,
    });

    const res = createResponse();

    await handler(
      {
        body: {
          questionId: privateQuestion.id,
          candidateResponse: "My answer",
        },
      },
      res,
      jest.fn()
    );

    expect(res.statusCode).toBe(409);
    expect(res.payload.error).toBe("This question is inactive.");
    expect(res.payload.code).toBe("QUESTION_INACTIVE");
    expect(aiService.generateEvaluation).not.toHaveBeenCalled();
    expect(evaluationRepository.saveEvaluation).not.toHaveBeenCalled();
  });

  
it("returns 404 when the question does not exist", async () => {
  questionRepository.findById.mockResolvedValue(null);

  const res = createResponse();
  const next = jest.fn();

  await handler(
    {
      body: {
        questionId: "nonexistent-question",
        candidateResponse: "My candidate answer",
      },
    },
    res,
    next
  );

  expect(res.statusCode).toBe(404);
  expect(res.payload.error).toBe("Question not found.");
   expect(res.payload.code).toBe("QUESTION_NOT_FOUND");
  expect(aiService.generateEvaluation).not.toHaveBeenCalled();
  expect(evaluationRepository.saveEvaluation).not.toHaveBeenCalled();
  expect(next).not.toHaveBeenCalled();
});


it("returns 409 when the question is inactive", async () => {
  questionRepository.findById.mockResolvedValue({
    ...privateQuestion,
    active: false,
  });

  const res = createResponse();
  const next = jest.fn();

  await handler(
    {
      body: {
        questionId: privateQuestion.id,
        candidateResponse: "My candidate answer",
      },
    },
    res,
    next
  );

  expect(res.statusCode).toBe(409);
  expect(res.payload.error).toBe("This question is inactive.");
   expect(res.payload.code).toBe("QUESTION_INACTIVE");
  expect(aiService.generateEvaluation).not.toHaveBeenCalled();
  expect(evaluationRepository.saveEvaluation).not.toHaveBeenCalled();
  expect(next).not.toHaveBeenCalled();
});



});
