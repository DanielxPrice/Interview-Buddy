const express = require("express");

function createSessionRouter({ sessionRepository }) {
if (!sessionRepository) {
throw new Error(
"createSessionRouter requires sessionRepository."
);
}

const router = express.Router();

function requireUser(req, res) {
if (!req.user?.uid) {
res.status(401).json({
error: "Authentication is required.",
});

  return false;
}

return true;


}

// Create a new interview session.
router.post("/", async (req, res, next) => {
try {
  const { mode, jobRole, experienceLevel } = req.body || {};

  if (!mode || !jobRole || !experienceLevel) {
    return res.status(400).json({
      error: "Mode, job role, and experience level are required.",
    });
  }

  const session = await sessionRepository.createSession({
    userId: req.user.uid,
    mode,
    jobRole,
    experienceLevel,
  });

  return res.status(201).json({ session });
} catch (error) {
  return next(error);
}

});

// List sessions belonging to the authenticated user.
router.get("/", async (req, res, next) => {
try {
  const sessions = await sessionRepository.listByUser(
    req.user.uid
  );

  return res.status(200).json({ sessions });
} catch (error) {
  return next(error);
}

});

// Retrieve one session, provided it belongs to this user.
router.get("/:sessionId", async (req, res, next) => {
try {

  const session = await sessionRepository.findById(
    req.params.sessionId
  );

  if (!session || session.userId !== req.user.uid) {
    return res.status(404).json({
      error: "Session not found.",
    });
  }

  return res.status(200).json({ session });
} catch (error) {
  return next(error);
}

});

// Complete a session, provided it belongs to this user.
router.patch("/:sessionId/complete", async (req, res, next) => {
try {
  const existingSession = await sessionRepository.findById(
    req.params.sessionId
  );

  if (
    !existingSession ||
    existingSession.userId !== req.user.uid
  ) {
    return res.status(404).json({
      error: "Session not found.",
    });
  }

  const session = await sessionRepository.completeSession(
    req.params.sessionId
  );

  return res.status(200).json({ session });
} catch (error) {
  return next(error);
}

});

return router;
}

module.exports = createSessionRouter;
