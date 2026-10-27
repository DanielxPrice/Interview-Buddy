
const express = require("express");
const cors = require("cors");

const createQuestionRouter = require("./routes/questions");
const createEvaluateRouter = require("./routes/evaluate");
const createUserRouter = require("./routes/users");
const createSessionRouter = require("./routes/sessions");
const createAccountDeletionRouter = require("./routes/accountDeletion");

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
  accountDeletionService,
  authClient,
} = require("./repositories");

const questionMetadataService = createQuestionMetadataService({
  questionRepository,
  catalogRepository: questionCatalogRepository,
});

const questionQuotaService = createQuestionQuotaService({
  usageRepository: questionUsageRepository,
});

const app = express();

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || "http://localhost:3000",
  })
);

// Requests from the React client are plain JSON.
// Reject compressed request bodies to prevent decompression attacks.
app.use(
  express.json({
    limit: "1mb",
    inflate: false,
  })
);

// Public health endpoint.
app.get("/api/health", (req, res) => {
  res.json(getHealthPayload());
});

// Protected question endpoints.
app.use(
  "/api/questions",
  requireAuth,
  createQuestionRouter({
    questionRepository,
    questionQuotaService,
    questionMetadataService,
  })
);

// Protected AI evaluation endpoints.
app.use(
  "/api/evaluate",
  requireAuth,
  createEvaluateRouter({
    questionRepository,
    evaluationRepository,
    sessionRepository,
  })
);

// Protected user profile endpoints.
app.use(
  "/api/users",
  requireAuth,
  createUserRouter({ userRepository })
);

// Account deletion endpoints.
app.use(
  "/api/users",
  requireAuth,
  createAccountDeletionRouter({
    accountDeletionService,
    authClient,
  })
);

// Protected interview session endpoints.
app.use(
  "/api/sessions",
  requireAuth,
  createSessionRouter({
    sessionRepository,
    questionRepository,
  })
);

// Centralized error handling.
app.use((error, req, res, _next) => {
  if (error && error.type === "encoding.unsupported") {
    return res.status(415).json({
      code: "UNSUPPORTED_CONTENT_ENCODING",
      error: "Compressed request bodies are not supported.",
    });
  }

  if (error && error.type === "entity.too.large") {
    return res.status(413).json({
      code: "REQUEST_BODY_TOO_LARGE",
      error: "Request body exceeds the allowed size.",
    });
  }

  if (error && error.type === "entity.parse.failed") {
    return res.status(400).json({
      code: "INVALID_JSON",
      error: "Request body must contain valid JSON.",
    });
  }

  console.error(error);

  return res.status(500).json({
    error:
      "The Interview Buddy server could not complete the request.",
  });
});

module.exports = app;
