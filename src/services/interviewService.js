import { auth } from "../config/firebase";
import {
  getCachedSetupOptions,
  subscribeSetupMetadata,
  refreshSetupMetadata,
  resetMetadataVerification,
} from "./questionMetadataCache";

/**
 * React-facing interview/session service facade.
 *
 * The page layer calls this service instead of talking directly to Firebase.
 * Database access stays behind the Express application layer.
 */

export const INTERVIEW_MODES = Object.freeze({
  QUIZ: "Quiz Style",
  CODE: "Code Style",
  THEORETICAL: "Theoretical Style",
});

const VALID_MODES = Object.values(
  INTERVIEW_MODES
);

const API_BASE_URL = (
  process.env.REACT_APP_API_BASE_URL ||
  "http://localhost:5001/api"
).replace(/\/$/, "");

async function getIdToken() {
  const user = auth.currentUser;

  if (!user) {
    throw new Error(
      "Authenticated Firebase user is required."
    );
  }

  return user.getIdToken();
}

function validateMode(mode) {
  if (!VALID_MODES.includes(mode)) {
    throw new Error(
      `Invalid interview mode: ${mode || "none"}`
    );
  }
}

function normalizeTags(value) {
  const values = Array.isArray(value)
    ? value
    : [value];

  return [
    ...new Set(
      values
        .flatMap((entry) =>
          String(entry || "").split(",")
        )
        .map((tag) => tag.trim())
        .filter(Boolean)
    ),
  ];
}

/**
 * Read an Express JSON response.
 *
 * In addition to the message, preserve backend
 * metadata such as the error code and quota state.
 *
 * This lets pages distinguish:
 *
 * normal network/server failure
 *
 * from
 *
 * daily-question-limit-exceeded
 */
async function readJsonResponse(response) {
  let payload = null;

  try {
    payload = await response.json();
  } catch (error) {
    // Leave payload as null so the caller still
    // receives a useful HTTP error.
  }

  if (!response.ok) {
    const message =
      payload?.error ||
      payload?.message ||
      `Interview service request failed (${response.status}).`;

    const serviceError =
      new Error(message);

    serviceError.code =
      payload?.code ||
      "interview-service-error";

    serviceError.status =
      response.status;

    serviceError.quota =
      payload?.quota ||
      null;

    throw serviceError;
  }

  return payload;
}

function normalizeQuota(quota) {
  if (!quota) {
    return null;
  }

  const unlimited =
    Boolean(quota.unlimited);

  return {
    role:
      String(
        quota.role || ""
      ),

    unlimited,

    limit:
      quota.limit === null ||
      quota.limit === undefined
        ? null
        : Number(quota.limit),

    used:
      Number(
        quota.used || 0
      ),

    remaining:
      quota.remaining === null ||
      quota.remaining === undefined
        ? null
        : Number(
            quota.remaining
          ),

    codeQuestionsUsed:
      Number(
        quota.codeQuestionsUsed ||
        0
      ),

    theoreticalQuestionsUsed:
      Number(
        quota
          .theoreticalQuestionsUsed ||
          0
      ),

    dateKey:
      String(
        quota.dateKey || ""
      ),

    timeZone:
      String(
        quota.timeZone || ""
      ),
  };
}

export const interviewService = {
  async startSession(configuration) {
    if (!configuration) {
      throw new Error(
        "Interview configuration is required."
      );
    }

    const {
      mode,
      jobRole,
      experienceLevel,
      tags,
      // Compatibility fallback for older callers/tests.
      practiceGoals,
      codingLanguage,
      questionCount = 10,
    } = configuration;

    validateMode(mode);

    const selectedTags =
      normalizeTags(tags);

    const normalizedTags =
      selectedTags.length > 0
        ? selectedTags
        : normalizeTags(
            practiceGoals
          );

    if (
      !jobRole ||
      !experienceLevel ||
      normalizedTags.length === 0
    ) {
      throw new Error(
        "Job role, experience level, and at least one tag are required."
      );
    }

    const normalizedQuestionCount =
      Number(questionCount);

    if (
      !Number.isInteger(
        normalizedQuestionCount
      ) ||
      normalizedQuestionCount < 1 ||
      normalizedQuestionCount > 20
    ) {
      throw new Error(
        "Question count must be an integer between 1 and 20."
      );
    }

        
    const idToken = await getIdToken();

    const response = await fetch(
      `${API_BASE_URL}/sessions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          mode,
          jobRole,
          experienceLevel,
        }),
      }
    );

    const session = await readJsonResponse(response);

    return {
      ...session,
      tags: normalizedTags,
      practiceGoals: normalizedTags.join(", "),
      codingLanguage: codingLanguage || null,
      questionCount: normalizedQuestionCount,
    };
  },

  /**
   * Retrieve the user's current shared
   * Code + Theoretical daily allowance.
   *
   * Quiz Style does not consume this allowance,
   * but the endpoint itself is mode-independent.
   */
  async getQuestionQuota() {
    const idToken =
      await getIdToken();

    const response =
      await fetch(
        `${API_BASE_URL}/questions/quota`,
        {
          headers: {
            Authorization:
              `Bearer ${idToken}`,
          },
        }
      );

    const payload =
      await readJsonResponse(
        response
      );

    return normalizeQuota(
      payload?.quota
    );
  },

  // Synchronous local lookups remove the format-switching loading delay.
  getCachedSetupOptions,
  subscribeSetupMetadata,
  refreshSetupMetadata,
  resetMetadataVerification,

  async getSetupOptions(mode, filters = {}) {
    return getCachedSetupOptions(mode, filters);
  },

  /**
   * Retrieve interview questions through
   * the backend.
   *
   * The backend performs the actual quota
   * reservation for Code/Theoretical modes.
   */
  async getQuestions({
    sessionId = "",
    mode,
    jobRole = "",
    experienceLevel = "",
    tags,
    practiceGoals = "",
    limit = 10,
  } = {}) {
    validateMode(mode);

    const selectedTags =
      normalizeTags(tags);

    const normalizedTags =
      selectedTags.length > 0
        ? selectedTags
        : normalizeTags(
            practiceGoals
          );

    if (
      !jobRole ||
      !experienceLevel ||
      normalizedTags.length === 0
    ) {
      throw new Error(
        "Job role, experience level, and at least one tag are required."
      );
    }

    const params =
      new URLSearchParams({
        mode,
        jobRole,
        experienceLevel,
        limit: String(limit),
      });

    if (sessionId) {
      params.set(
        "sessionId",
        sessionId
      );
    }

    normalizedTags.forEach(
      (tag) => {
        params.append(
          "tags",
          tag
        );
      }
    );

    const idToken =
      await getIdToken();

    const response =
      await fetch(
        `${API_BASE_URL}/questions?${params.toString()}`,
        {
          headers: {
            Authorization:
              `Bearer ${idToken}`,
          },
        }
      );

    const payload =
      await readJsonResponse(
        response
      );

    return Array.isArray(
      payload?.questions
    )
      ? payload.questions
      : [];
  },

  /**
   * Validate a Quiz Style answer
   * on the server.
   */
  async checkQuizAnswer(
    questionId,
    answer
  ) {
    if (!questionId) {
      throw new Error(
        "Question ID is required."
      );
    }

    if (
      !answer ||
      !String(answer).trim()
    ) {
      throw new Error(
        "An answer is required."
      );
    }

    const idToken =
      await getIdToken();

    const response =
      await fetch(
        `${API_BASE_URL}/questions/${encodeURIComponent(
          questionId
        )}/check`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            Authorization:
              `Bearer ${idToken}`,
          },

          body: JSON.stringify({
            answer,
          }),
        }
      );

    return readJsonResponse(
      response
    );
  },

  /**
   * Retained for the service contract
   * established by the prototype.
   */
  async getQuestion(sessionId) {
    if (!sessionId) {
      throw new Error(
        "Session ID is required."
      );
    }

    return null;
  },

  async submitAnswer(
    sessionId,
    questionId,
    answer
  ) {
    if (
      !sessionId ||
      !questionId
    ) {
      throw new Error(
        "Session ID and question ID are required."
      );
    }

    if (
      answer === undefined ||
      answer === null ||
      String(answer).trim() ===
        ""
    ) {
      throw new Error(
        "An answer is required."
      );
    }

    return {
      success: true,
      sessionId,
      questionId,
    };
  },

  
  async endSession(sessionId) {
    if (!sessionId) {
      throw new Error("Session ID is required.");
    }

    const idToken = await getIdToken();

    const response = await fetch(
      `${API_BASE_URL}/sessions/${encodeURIComponent(sessionId)}/complete`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      }
    );

    return readJsonResponse(response);
  },
};