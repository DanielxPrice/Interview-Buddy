
const express = require("express");
const cors = require("cors");

const createQuestionRouter = require("./routes/questions");
const createEvaluateRouter = require("./routes/evaluate");
const createUserRouter = require("./routes/users");
const createSessionRouter = require("./routes/sessions");
const createAccountDeletionRouter = require("./routes/accountDeletion");

const requireAuth = require("./middleware/requireAuth");
const createRequireAccountReady = require("./middleware/requireAccountReady");
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

const questionMetadataService =
  createQuestionMetadataService({
    questionRepository,
    catalogRepository: questionCatalogRepository,
  });

const questionQuotaService =
  createQuestionQuotaService({
    usageRepository: questionUsageRepository,
  });

const requireAccountReady =
  createRequireAccountReady({
    userRepository,
  });

const app = express();

app.use(
  cors({
    origin:
      process.env.CLIENT_ORIGIN ||
      "http://localhost:3000",
  })
);

// Preserve SEC-01 request-parser protections.
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

// Authentication and account-readiness
// checks run before protected question routes.
app.use(
  "/api/questions",
  requireAuth,
  requireAccountReady,
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
  requireAccountReady,
  createEvaluateRouter({
    questionRepository,
    evaluationRepository,
    sessionRepository,
  })
);

// Protected profile/settings routes.
app.use(
  "/api/users",
  requireAuth,
  requireAccountReady,
  createUserRouter({
    userRepository,
  })
);

// Secure account deletion.
// Incomplete accounts can still delete themselves.
app.use(
  "/api/users",
  requireAuth,
  requireAccountReady,
  createAccountDeletionRouter({
    accountDeletionService,
    authClient,
  })
);

// Protected interview session routes.
app.use(
  "/api/sessions",
  requireAuth,
  requireAccountReady,
  createSessionRouter({
    sessionRepository,
    questionRepository,
  })
);

// Preserve SEC-01 parser error handling.
app.use((error, req, res, _next) => {
  if (
    error &&
    error.type === "encoding.unsupported"
  ) {
    return res.status(415).json({
      code: "UNSUPPORTED_CONTENT_ENCODING",
      error:
        "Compressed request bodies are not supported.",
    });
  }

  if (
    error &&
    error.type === "entity.too.large"
  ) {
    return res.status(413).json({
      code: "REQUEST_BODY_TOO_LARGE",
      error:
        "Request body exceeds the allowed size.",
    });
  }

  if (
    error &&
    error.type === "entity.parse.failed"
  ) {
    return res.status(400).json({
      code: "INVALID_JSON",
      error:
        "Request body must contain valid JSON.",
    });
  }

  console.error(error);

  return res.status(500).json({
    error:
      "The Interview Buddy server could not complete the request.",
  });
});

module.exports = app;
