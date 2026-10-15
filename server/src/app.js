
const express = require("express");
const cors = require("cors");

const createQuestionRouter = require("./routes/questions");
const createEvaluateRouter = require("./routes/evaluate");
const createUserRouter = require("./routes/users");
const createSessionRouter = require("./routes/sessions");

const requireAuth = require("./middleware/requireAuth");
const getHealthPayload = require("./health");

const {
  createQuestionQuotaService,
} = require("./services/questionQuotaService");

const {
  createQuestionMetadataService,
} = require("./services/questionMetadataService");

const {
  questionRepository,
  questionCatalogRepository,
  evaluationRepository,
  userRepository,
  questionUsageRepository,
  sessionRepository,
} = require("./repositories");

// Initialize question metadata service.
const questionMetadataService =
  createQuestionMetadataService({
    questionRepository,
    catalogRepository: questionCatalogRepository,
  });

// Initialize daily question quota service.
const questionQuotaService =
  createQuestionQuotaService({
    usageRepository: questionUsageRepository,
  });

// Create Express application.
const app = express();

// Configure CORS.
app.use(
  cors({
    origin:
      process.env.CLIENT_ORIGIN ||
      "http://localhost:3000",
  })
);

// Configure JSON request parsing.
app.use(
  express.json({
    limit: "1mb",
  })
);

// Health endpoint.
app.get("/api/health", (req, res) => {
  res.json(getHealthPayload());
});

// Protected question routes.
app.use(
  "/api/questions",
  requireAuth,
  createQuestionRouter({
    questionRepository,
    questionQuotaService,
    questionMetadataService,
  })
);

// Protected AI evaluation routes.
app.use(
  "/api/evaluate",
  requireAuth,
  createEvaluateRouter({
    questionRepository,
    evaluationRepository,
    sessionRepository,
  })
);

// Protected user routes.
app.use(
  "/api/users",
  requireAuth,
  createUserRouter({
    userRepository,
  })
);

// Protected session routes.
app.use(
  "/api/sessions",
  requireAuth,
  createSessionRouter({
    sessionRepository,
  })
);

// Centralized error handler.
app.use((error, req, res, _next) => {
  console.error(error);

  res.status(500).json({
    error:
      "The Interview Buddy server could not complete the request.",
  });
});

module.exports = app;
