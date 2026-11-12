
const express = require("express");
const cors = require("cors");

const createQuestionRouter = require("./routes/questions");
const createEvaluateRouter = require("./routes/evaluate");
const createUserRouter = require("./routes/users");
const createSessionRouter = require("./routes/sessions");
const createLeaderboardRouter = require("./routes/leaderboard");
const createFriendsRouter = require("./routes/friends");
const createAccountDeletionRouter = require("./routes/accountDeletion");

const requireAuth = require("./middleware/requireAuth");
const createRequireAccountReady = require("./middleware/requireAccountReady");
const createApiRateLimiter = require("./middleware/createApiRateLimiter");
const getHealthPayload = require("./health");

const {
  createQuestionQuotaService,
} = require("./services/questionQuotaService");

const {
  createQuestionMetadataService,
} = require("./services/questionMetadataService");

const {
  apiRateLimitRepository,
  questionRepository,
  questionCatalogRepository,
  evaluationRepository,
  userRepository,
  friendshipRepository,
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

const apiRateLimiter = createApiRateLimiter({
  rateLimitRepository: apiRateLimitRepository,
});

const app = express();

app.use(
  cors({
    origin:
      process.env.CLIENT_ORIGIN ||
      "http://localhost:3000",
  })
);

// SEC-01 request-parser protections.
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

// Protected question routes.
app.use(
  "/api/questions",
  requireAuth,
  apiRateLimiter,
  requireAccountReady,
  createQuestionRouter({
    questionRepository,
    questionQuotaService,
    questionMetadataService,
    sessionRepository,
  })
);

// Protected AI evaluation routes.
app.use(
  "/api/evaluate",
  requireAuth,
  apiRateLimiter,
  requireAccountReady,
  createEvaluateRouter({
    questionRepository,
    evaluationRepository,
    sessionRepository,
  })
);

// Authentication and rate limiting are mounted once for user routes.
app.use(
  "/api/users",
  requireAuth,
  apiRateLimiter,
  requireAccountReady
);

// Protected profile and settings routes.
app.use(
  "/api/users",
  createUserRouter({ userRepository })
);

// Secure account deletion.
app.use(
  "/api/users",
  createAccountDeletionRouter({
    accountDeletionService,
    authClient,
  })
);

// Protected interview session routes.
app.use(
  "/api/sessions",
  requireAuth,
  apiRateLimiter,
  requireAccountReady,
  createSessionRouter({
    sessionRepository,
    questionRepository,
  })
);

// Global, personal, and accepted-friends rankings.
app.use(
  "/api/leaderboard",
  requireAuth,
  apiRateLimiter,
  requireAccountReady,
  createLeaderboardRouter({ userRepository, friendshipRepository })
);

// SCRUM-109: Friendship application endpoints.
// Storage and relationship integrity remain in Hoonam's repository.
app.use(
  "/api/friends",
  requireAuth,
  apiRateLimiter,
  requireAccountReady,
  createFriendsRouter({
    userRepository,
    friendshipRepository,
  })
);

// SEC-01 parser error handling.
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
