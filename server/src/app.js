const express = require("express");
const cors = require("cors");
const createQuestionRouter = require("./routes/questions");
const createEvaluateRouter = require("./routes/evaluate");
const createUserRouter = require("./routes/users");
const requireAuth = require("./middleware/requireAuth");
const createSessionRouter = require("./routes/sessions");

const {
  questionRepository,
  evaluationRepository,
  userRepository,
  sessionRepository,
} = require("./repositories");

const app = express();

app.use(
  cors({
    origin:
      process.env.CLIENT_ORIGIN ||
      "http://localhost:3000",
  })
);

app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "interview-buddy-api",
  });
});

app.use(
  "/api/questions",
  requireAuth,
  createQuestionRouter({
    questionRepository,
  })
);

app.use(
  "/api/evaluate",
  requireAuth,
  createEvaluateRouter({
    questionRepository,
    evaluationRepository,
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

app.use((error, req, res, next) => {
  console.error(error);

  res.status(500).json({
    error:
      "The Interview Buddy server could not complete the request.",
  });

});

module.exports = app;