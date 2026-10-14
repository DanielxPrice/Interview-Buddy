const express =
  require("express");

const cors =
  require("cors");

const createQuestionRouter =
  require(
    "./routes/questions"
  );

const createEvaluateRouter =
  require(
    "./routes/evaluate"
  );

const createUserRouter =
  require(
    "./routes/users"
  );

const createSessionRouter = 
  require(
    "./routes/sessions"
  );

const requireAuth =
  require(
    "./middleware/requireAuth"
  );

const getHealthPayload =
  require("./health");

const {
  createQuestionQuotaService,
} = require(
  "./services/questionQuotaService"
);

const {
  questionRepository,

  evaluationRepository,

  userRepository,

  questionUsageRepository,

  sessionRepository,
} = require(
  "./repositories"
);

const { createQuestionMetadataService } = require(
  "./services/questionMetadataService"
);
const { questionCatalogRepository } = require("./repositories");
const questionMetadataService = createQuestionMetadataService({
  questionRepository,
  catalogRepository: questionCatalogRepository,
});

const questionQuotaService =
  createQuestionQuotaService({
    usageRepository:
      questionUsageRepository,
  });

const app =
  express();

app.use(
  cors({
    origin:
      process.env
        .CLIENT_ORIGIN ||
      "http://localhost:3000",
  })
);

app.use(
  express.json({
    limit: "1mb",
  })
);

app.get(
  "/api/health",

  (req, res) => {
    res.json(
      getHealthPayload()
    );
  }
);

app.use(
  "/api/questions",

  requireAuth,

  createQuestionRouter({
    questionRepository,

    questionQuotaService,
    questionMetadataService,
  })
);

app.use(
  "/api/evaluate",

  requireAuth,
  
  createEvaluateRouter({
    questionRepository,

    evaluationRepository,
    
    sessionRepository,
  })
);

app.use(
  "/api/users",

  requireAuth,

  createUserRouter({
    userRepository,
  })
);

app.use(
  "/api/sessions",
  requireAuth,
  createSessionRouter({
    sessionRepository,
  })
);

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      error
    );

    res.status(500).json({
      error:
        "The Interview Buddy server could not complete the request.",
    });
  }
);

module.exports =
  app;