import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import PageLayout from "../components/layout/PageLayout";

import CodeEditor from "../components/interview/CodeEditor";

import LoadingState from "../components/state/LoadingState";
import ErrorState from "../components/state/ErrorState";
import SubmittingState from "../components/state/SubmittingState";

import { PAGES } from "../utils/constants";

import {
  buildSessionResult,
  getEndSessionErrorMessage,
  isRetryableEndSessionError,
} from "../utils/sessionResults";

import {
  aiService,
  interviewService,
} from "../services";

function getModeDetails(mode) {
  switch (mode) {
    case "Quiz Style":
      return {
        icon: "▣",
        label: "Quiz Style",
        description:
          "Multiple choice technical interview practice.",
      };

    case "Code Style":
      return {
        icon: "‹›",
        label: "Code Style",
        description:
          "Coding and technical solution practice.",
      };

    case "Theoretical Style":
      return {
        icon: "◎",
        label: "Theoretical Style",
        description:
          "Technical concept explanation practice.",
      };

    default:
      return {
        icon: "?",
        label:
          mode || "Interview",
        description:
          "Technical interview practice.",
      };
  }
}

function calculateAverageScore(
  answers
) {
  if (!answers.length) {
    return 0;
  }

  const total =
    answers.reduce(
      (sum, answer) =>
        sum +
        Number(
          answer.score || 0
        ),
      0
    );

  return Math.round(
    total / answers.length
  );
}


/**
 * Select an editor language only when a question explicitly requires one.
 * Tags and topic come from the existing public questions API; the prompt
 * check supports question records that omit language tags.
 * General algorithm questions remain language-neutral (Python default).
 */
function getDefaultCodeLanguage(question) {
  if (!question) {
    return "python";
  }

  const tags = Array.isArray(question.tags)
    ? question.tags.map((tag) =>
        String(tag).trim().toLowerCase()
      )
    : [];

  const topic = String(question.topic || "")
    .trim()
    .toLowerCase();

  const prompt = String(question.prompt || "");

  if (
    tags.includes("sql") ||
    tags.includes("postgresql") ||
    topic === "sql" ||
    /^\s*SQL dialect\s*:/i.test(prompt)
  ) {
    return "sql";
  }

  if (
    tags.includes("javascript") ||
    tags.includes("js") ||
    topic === "javascript" ||
    /^\s*Task\s*\(\s*JavaScript\s*\)/i.test(prompt)
  ) {
    return "javascript";
  }

  return "python";
}

function InterviewSessionPage({
  currentPage,
  onNavigate,
  selectedMode,
  setupData,
  onEndInterview,
}) {
  const [
    questions,
    setQuestions,
  ] = useState([]);

  const [
    currentQuestionIndex,
    setCurrentQuestionIndex,
  ] = useState(0);

  const [
    isLoadingQuestions,
    setIsLoadingQuestions,
  ] = useState(true);

  const [
    questionLoadError,
    setQuestionLoadError,
  ] = useState("");

  const [
    questionQuotaError,
    setQuestionQuotaError,
  ] = useState(null);

  const [
    selectedQuizAnswer,
    setSelectedQuizAnswer,
  ] = useState("");

  const [
    writtenAnswer,
    setWrittenAnswer,
  ] = useState("");

  const [
    codeLanguage,
    setCodeLanguage,
  ] = useState(
    "python"
  );

  const [
    isSubmitting,
    setIsSubmitting,
  ] = useState(false);

  const [
    submissionError,
    setSubmissionError,
  ] = useState("");

  const [
    evaluationResult,
    setEvaluationResult,
  ] = useState(null);

  const [
    answeredQuestions,
    setAnsweredQuestions,
  ] = useState([]);

  const [
    isEndingSession, 
    setIsEndingSession
  ] = useState(false);

  const [
    endSessionError,
    setEndSessionError
  ] = useState("");

  // False when ending again will not help (session missing, not yours,
  // or no longer active), so the page offers a new session instead.
  const [
    canRetryEndSession,
    setCanRetryEndSession
  ] = useState(true);

  const modeDetails =
    getModeDetails(
      selectedMode
    );

  const currentQuestion =
    questions[
      currentQuestionIndex
    ] || null;

  const isQuiz =
    selectedMode ===
    "Quiz Style";

  const isCode =
    selectedMode ===
    "Code Style";

  const isTheoretical =
    selectedMode ===
    "Theoretical Style";

  const submissionMessage =
    useMemo(() => {
      if (isQuiz) {
        return "Checking answer...";
      }

      if (isCode) {
        return "Evaluating solution...";
      }

      return "Evaluating response...";
    }, [
      isQuiz,
      isCode,
    ]);

  const questionCount =
    questions.length;

  const currentQuestionNumber =
    questionCount > 0
      ? currentQuestionIndex + 1
      : 0;

  /*
  * Session progress should represent
  * completed questions, not the question
  * currently being viewed.
  *
  * Example:
  * 0 of 10 answered = 0%
  * 1 of 10 answered = 10%
  * 5 of 10 answered = 50%
  */
  const progressPercent =
    questionCount > 0
      ? Math.round(
          (answeredQuestions.length /
            questionCount) *
            100
        )
      : 0;

  const currentAverageScore =
    useMemo(
      () =>
        calculateAverageScore(
          answeredQuestions
        ),
      [answeredQuestions]
    );

  const loadQuestions =
    useCallback(
      async () => {
        if (!selectedMode) {
          setQuestions([]);
          setQuestionLoadError(
            "No interview mode was selected."
          );
          setIsLoadingQuestions(
            false
          );
          return;
        }

        setIsLoadingQuestions(
          true
        );

        setQuestionLoadError(
          ""
        );

        setQuestionQuotaError(
          null
        );

        try {
          const loadedQuestions =
            await interviewService.getQuestions(
              {
                sessionId:
                  setupData?.id ||
                  "",

                mode:
                  selectedMode,

                jobRole:
                  setupData?.jobRole ||
                  "",

                experienceLevel:
                  setupData?.experienceLevel ||
                  "",

                tags:
                  setupData?.tags ||
                  [],

                limit:
                  Number(
                    setupData?.questionCount ||
                    10
                  ),
              }
            );

          const normalizedQuestions =
            Array.isArray(
              loadedQuestions
            )
              ? loadedQuestions
              : [];

          if (
            normalizedQuestions.length ===
            0
          ) {
            setQuestions([]);

            setQuestionLoadError(
              `No active ${selectedMode} questions were returned from Firebase.`
            );

            return;
          }

          setQuestions(
            normalizedQuestions
          );

          setCurrentQuestionIndex(
            0
          );
        } catch (error) {
            setQuestions([]);

            if (
              error?.code ===
              "daily-question-limit-exceeded"
            ) {
              setQuestionQuotaError({
                limit:
                  Number(
                    error?.quota?.limit ||
                      0
                  ),

                used:
                  Number(
                    error?.quota?.used ||
                      0
                  ),

                requested:
                  Number(
                    error?.quota?.requested ||
                      0
                  ),

                remaining:
                  Number(
                    error?.quota?.remaining ||
                      0
                  ),
              });

              setQuestionLoadError(
                error.message ||
                  "Your daily Code + Theoretical question allowance changed before the session could begin."
              );

              return;
            }

            setQuestionQuotaError(
              null
            );

            setQuestionLoadError(
              error?.message ||
                "Unable to load interview questions."
            );
          } finally {
          setIsLoadingQuestions(
            false
          );
        }
      },
      [
        selectedMode,
        setupData,
      ]
    );

  function handleReturnToSetup() {
    onNavigate(
      PAGES.INTERVIEW_SETUP
    );
  }

  useEffect(() => {
    loadQuestions();
  }, [loadQuestions]);

  // Reset the editor only when the question changes. Users can still
  // select a different language manually for the current question.
  useEffect(() => {
    if (isCode && currentQuestion) {
      setCodeLanguage(
        getDefaultCodeLanguage(currentQuestion)
      );
    }
  }, [isCode, currentQuestion]);

  function resetQuestionState() {
    setSelectedQuizAnswer(
      ""
    );

    setWrittenAnswer("");

    setSubmissionError("");

    setEvaluationResult(
      null
    );

    setIsSubmitting(
      false
    );
  }

  async function handleSubmit() {
    if (
      !currentQuestion ||
      isSubmitting ||
      evaluationResult
    ) {
      return;
    }

    setSubmissionError(
      ""
    );

    if (
      isQuiz &&
      !selectedQuizAnswer
    ) {
      setSubmissionError(
        "Please select an answer before submitting."
      );

      return;
    }

    if (
      !isQuiz &&
      !writtenAnswer.trim()
    ) {
      setSubmissionError(
        "Please enter an answer before submitting."
      );

      return;
    }

    setIsSubmitting(true);

    try {
      if (isQuiz) {
        const result =
          await interviewService.checkQuizAnswer(
            currentQuestion.id,
            selectedQuizAnswer,
            setupData?.id
          );

        const normalizedResult = {
          type: "quiz",

          isCorrect:
            Boolean(
              result?.isCorrect
            ),

          score:
            result?.isCorrect
              ? 100
              : 0,

          explanation:
            result?.explanation ||
            "",

          correctAnswer:
            result?.correctAnswer ||
            "",
        };

        setEvaluationResult(
          normalizedResult
        );

        setAnsweredQuestions(
          (currentAnswers) => [
            ...currentAnswers,

            {
              questionId:
                currentQuestion.id,

              question:
                currentQuestion.prompt,

              userAnswer:
                selectedQuizAnswer,

              isCorrect:
                normalizedResult.isCorrect,

              score:
                normalizedResult.score,

              feedback:
                normalizedResult.explanation,

              correctAnswer:
                normalizedResult.correctAnswer,
            },
          ]
        );

        return;
      }

      const result =
        await aiService.evaluateAnswer(
          {
            questionId:
              currentQuestion.id,

            userAnswer:
              writtenAnswer.trim(),

            sessionId:
              setupData?.id ||
              "",

            jobRole:
              setupData?.jobRole ||
              "",

            experienceLevel:
              setupData?.experienceLevel ||
              "",
          }
        );

      const normalizedResult = {
        type: "ai",

        score:
          Number(
            result?.score || 0
          ),

        feedback:
          result?.feedback ||
          "",

        strengths:
          Array.isArray(
            result?.strengths
          )
            ? result.strengths
            : [],

        weaknesses:
          Array.isArray(
            result?.weaknesses
          )
            ? result.weaknesses
            : [],

        suggestions:
          Array.isArray(
            result?.suggestions
          )
            ? result.suggestions
            : [],

        criterionResults:
          Array.isArray(
            result?.criterionResults
          )
            ? result.criterionResults
            : [],
      };

      setEvaluationResult(
        normalizedResult
      );

      setAnsweredQuestions(
        (currentAnswers) => [
          ...currentAnswers,

          {
            questionId:
              currentQuestion.id,

            question:
              currentQuestion.prompt,

            userAnswer:
              writtenAnswer.trim(),

            score:
              normalizedResult.score,

            isCorrect:
              normalizedResult.score >=
              70,

            feedback:
              normalizedResult.feedback,

            strengths:
              normalizedResult.strengths,

            weaknesses:
              normalizedResult.weaknesses,

            suggestions:
              normalizedResult.suggestions,

            criterionResults:
              normalizedResult.criterionResults,
          },
        ]
      );
    } catch (error) {
      const fallbackMessage =
        isQuiz
          ? "Unable to check your answer. Please try again."
          : "Unable to evaluate your response. Please try again.";

      setSubmissionError(
        error?.message ||
          fallbackMessage
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleNextQuestion() {
    if (
      currentQuestionIndex >=
      questions.length - 1
    ) {
      return;
    }

    resetQuestionState();

    setCurrentQuestionIndex(
      (currentIndex) =>
        currentIndex + 1
    );
  }

  
  async function handleEndInterview() {
    if (isEndingSession || isSubmitting) {
      return;
    }

    setIsEndingSession(true);
    setEndSessionError("");
    setCanRetryEndSession(true);

    try {
      if (!setupData?.id) {
        throw new Error("Session ID is missing.");
      }

      // The server calculates the official result (score, ELO, date,
      // breakdown). buildSessionResult merges it with the answer details
      // kept in the browser.
      const savedSession = await interviewService.endSession(setupData.id);

      onEndInterview(
        buildSessionResult({
          savedSession,
          answeredQuestions,
          mode: selectedMode,
          setupData,
        })
      );
    } catch (error) {
      // Turn the server's error code into a message the user can act on.
      setEndSessionError(getEndSessionErrorMessage(error));
      setCanRetryEndSession(isRetryableEndSessionError(error));
    } finally {
      setIsEndingSession(false);
    }
  }

  function renderQuizAnswerArea() {
    const options =
      Array.isArray(
        currentQuestion?.options
      )
        ? currentQuestion.options
        : [];

    return (
      <div className="sessionQuizOptions">
        {options.map(
          (
            option,
            index
          ) => {
            const optionId =
              `quiz-option-${index}`;

            const isSelected =
              selectedQuizAnswer ===
              option;

            return (
              <label
                key={
                  option
                }
                htmlFor={
                  optionId
                }
                className={`sessionQuizOption${
                  isSelected
                    ? " selected"
                    : ""
                }${
                  isSubmitting ||
                  evaluationResult
                    ? " disabled"
                    : ""
                }`}
              >
                <input
                  id={
                    optionId
                  }
                  type="radio"
                  name="quizAnswer"
                  value={
                    option
                  }
                  checked={
                    isSelected
                  }
                  disabled={
                    Boolean(
                      evaluationResult
                    ) ||
                    isSubmitting
                  }
                  onChange={() => {
                    setSelectedQuizAnswer(
                      option
                    );

                    setSubmissionError(
                      ""
                    );
                  }}
                />

                <span className="sessionQuizOptionLetter">
                  {String.fromCharCode(
                    65 +
                      index
                  )}
                </span>

                <span className="sessionQuizOptionText">
                  {option}
                </span>
              </label>
            );
          }
        )}
      </div>
    );
  }

  function renderWrittenAnswerArea() {
    const trimmedAnswer =
      writtenAnswer.trim();

    const wordCount =
      trimmedAnswer
        ? trimmedAnswer
            .split(/\s+/)
            .length
        : 0;

    const lineCount =
      writtenAnswer
        ? writtenAnswer
            .split("\n")
            .length
        : 0;


    function handleWrittenAnswerChange(
      nextValue
    ) {
      setWrittenAnswer(
        nextValue
      );

      setSubmissionError(
        ""
      );
    }


    return (
      <div className="sessionWrittenResponse">
        <div className="sessionResponseHeading">
          <div>
            <label
              className="sessionResponseLabel"
              htmlFor={
                isTheoretical
                  ? "interviewAnswer"
                  : undefined
              }
            >
              Your Response
            </label>


            {isTheoretical && (
              <p className="sessionResponseDescription">
                Answer as if you were
                explaining the concept
                directly to an interviewer.
              </p>
            )}


            {isCode && (
              <p className="sessionResponseDescription">
                Explain your approach and
                provide code or pseudocode
                as you would during a
                technical interview.
              </p>
            )}
          </div>


          {isTheoretical && (
            <span className="sessionResponseTypeBadge">
              Written Response
            </span>
          )}


          {isCode && (
            <span className="sessionResponseTypeBadge">
              Code Response
            </span>
          )}
        </div>


        {/* =========================
            THEORETICAL GUIDANCE
            ========================= */}

        {isTheoretical && (
          <div className="sessionAnswerGuidance">
            <div className="sessionGuidanceItem">
              <span className="sessionGuidanceNumber">
                1
              </span>

              <div>
                <strong>
                  Define the concept
                </strong>

                <span>
                  Start with a clear and
                  direct explanation.
                </span>
              </div>
            </div>


            <div className="sessionGuidanceItem">
              <span className="sessionGuidanceNumber">
                2
              </span>

              <div>
                <strong>
                  Explain your reasoning
                </strong>

                <span>
                  Describe why it works or
                  why it matters.
                </span>
              </div>
            </div>


            <div className="sessionGuidanceItem">
              <span className="sessionGuidanceNumber">
                3
              </span>

              <div>
                <strong>
                  Add context
                </strong>

                <span>
                  Use an example, tradeoff,
                  or use case when helpful.
                </span>
              </div>
            </div>
          </div>
        )}


        {/* =========================
            CODE GUIDANCE
            ========================= */}

        {isCode && (
          <div className="sessionCodeGuidance">
            <div className="sessionCodeGuidanceItem">
              <strong>
                Approach
              </strong>

              <span>
                Briefly explain how you plan
                to solve the problem.
              </span>
            </div>


            <div className="sessionCodeGuidanceItem">
              <strong>
                Implementation
              </strong>

              <span>
                Write code or clear
                pseudocode for your
                solution.
              </span>
            </div>


            <div className="sessionCodeGuidanceItem">
              <strong>
                Complexity
              </strong>

              <span>
                Include time and space
                complexity when relevant.
              </span>
            </div>
          </div>
        )}


        {/* =========================
            CODE EDITOR
            ========================= */}

        {isCode && (
          <div className="sessionCodeEditor">
            <div className="sessionCodeEditorHeader">
              <div
                className="sessionCodeWindowDots"
                aria-hidden="true"
              >
                <span />
                <span />
                <span />
              </div>

              <span>
                Interview Solution
              </span>

              <select
                className="sessionCodeLanguageSelect"
                aria-label="Programming Language"
                value={
                  codeLanguage
                }
                disabled={
                  Boolean(
                    evaluationResult
                  ) ||
                  isSubmitting
                }
                onChange={(event) => {
                  setCodeLanguage(
                    event.target.value
                  );
                }}
              >
                <option value="python">
                  Python
                </option>

                <option value="javascript">
                  JavaScript
                </option>

                <option value="java">
                  Java
                </option>

                <option value="cpp">
                  C++
                </option>

                <option value="sql">
                  SQL (PostgreSQL)
                </option>
              </select>
            </div>


            <CodeEditor
              value={
                writtenAnswer
              }

              language={
                codeLanguage
              }

              ariaLabel="Your Response"

              disabled={
                Boolean(
                  evaluationResult
                ) ||
                isSubmitting
              }

              onChange={
                handleWrittenAnswerChange
              }
            />
          </div>
        )}


        {/* =========================
            THEORETICAL TEXTAREA
            ========================= */}

        {isTheoretical && (
          <textarea
            id="interviewAnswer"

            className="sessionAnswerTextarea sessionAnswerTextarea--theoretical"

            placeholder="Explain your answer clearly. Include the main concept, your reasoning, and an example when relevant."

            value={
              writtenAnswer
            }

            disabled={
              Boolean(
                evaluationResult
              ) ||
              isSubmitting
            }

            onChange={(event) => {
              handleWrittenAnswerChange(
                event.target.value
              );
            }}
          />
        )}


        {/* =========================
            RESPONSE STATISTICS
            ========================= */}

        <div className="sessionResponseMeta">
          <div className="sessionResponseStats">
            {isTheoretical && (
              <span>
                {wordCount}{" "}
                {wordCount === 1
                  ? "word"
                  : "words"}
              </span>
            )}


            {isCode && (
              <span>
                {lineCount}{" "}
                {lineCount === 1
                  ? "line"
                  : "lines"}
              </span>
            )}


            <span>
              {writtenAnswer.length}{" "}
              characters
            </span>
          </div>


          {isCode && (
            <span>
              AI evaluates your response;
              code is not executed.
            </span>
          )}


          {isTheoretical && (
            <span>
              Focus on clarity,
              accuracy, and explanation.
            </span>
          )}
        </div>
      </div>
    );
  }

  function renderQuizFeedback() {
    if (
      !evaluationResult ||
      evaluationResult.type !==
        "quiz"
    ) {
      return null;
    }

    return (
      <section
        className={`sessionFeedbackCard ${
          evaluationResult.isCorrect
            ? "sessionFeedbackCard--success"
            : "sessionFeedbackCard--error"
        }`}
        aria-live="polite"
      >
        <div className="sessionFeedbackHeading">
          <div className="sessionFeedbackIcon">
            {evaluationResult.isCorrect
              ? "✓"
              : "×"}
          </div>

          <div>
            <span className="ib-eyebrow">
              Answer Feedback
            </span>

            <h3>
              {evaluationResult.isCorrect
                ? "Correct Answer"
                : "Incorrect Answer"}
            </h3>
          </div>
        </div>

        {evaluationResult.explanation && (
          <p className="sessionFeedbackText">
            {
              evaluationResult.explanation
            }
          </p>
        )}

        {!evaluationResult.isCorrect &&
          evaluationResult.correctAnswer && (
            <div className="sessionCorrectAnswer">
              <span>
                Correct answer
              </span>

              <strong>
                {
                  evaluationResult.correctAnswer
                }
              </strong>
            </div>
          )}
      </section>
    );
  }

  function renderAiFeedback() {
    if (
      !evaluationResult ||
      evaluationResult.type !==
        "ai"
    ) {
      return null;
    }

    return (
      <section
        className="sessionFeedbackCard"
        aria-live="polite"
      >
        <div className="sessionAiScoreRow">
          <div>
            <span className="ib-eyebrow">
              AI Evaluation
            </span>

            <h3>
              Response Feedback
            </h3>
          </div>

          <div className="sessionAiScore">
            Score:{" "}
            {
              evaluationResult.score
            }
            /100
          </div>
        </div>

        {evaluationResult.feedback && (
          <p className="sessionFeedbackText">
            {
              evaluationResult.feedback
            }
          </p>
        )}

        {evaluationResult.strengths.length >
          0 && (
          <div className="sessionFeedbackGroup">
            <h4>
              Strengths
            </h4>

            <ul>
              {evaluationResult.strengths.map(
                (
                  strength
                ) => (
                  <li
                    key={
                      strength
                    }
                  >
                    {
                      strength
                    }
                  </li>
                )
              )}
            </ul>
          </div>
        )}

        {evaluationResult.weaknesses.length >
          0 && (
          <div className="sessionFeedbackGroup">
            <h4>
              Areas to Improve
            </h4>

            <ul>
              {evaluationResult.weaknesses.map(
                (
                  weakness
                ) => (
                  <li
                    key={
                      weakness
                    }
                  >
                    {
                      weakness
                    }
                  </li>
                )
              )}
            </ul>
          </div>
        )}

        {evaluationResult.suggestions.length >
          0 && (
          <div className="sessionFeedbackGroup">
            <h4>
              Suggestions
            </h4>

            <ul>
              {evaluationResult.suggestions.map(
                (
                  suggestion
                ) => (
                  <li
                    key={
                      suggestion
                    }
                  >
                    {
                      suggestion
                    }
                  </li>
                )
              )}
            </ul>
          </div>
        )}

        {evaluationResult.criterionResults.length >
          0 && (
          <div className="sessionCriteria">
            {evaluationResult.criterionResults.map(
              (
                criterion,
                index
              ) => (
                <div
                  key={
                    criterion.name ||
                    index
                  }
                  className="sessionCriterion"
                >
                  <div className="sessionCriterionHeader">
                    <strong>
                      {
                        criterion.name
                      }
                    </strong>

                    <span>
                      {
                        criterion.awardedPoints
                      }
                      /
                      {
                        criterion.maxPoints
                      }
                    </span>
                  </div>

                  {criterion.feedback && (
                    <p>
                      {
                        criterion.feedback
                      }
                    </p>
                  )}
                </div>
              )
            )}
          </div>
        )}
      </section>
    );
  }

  if (isLoadingQuestions) {
    return (
      <PageLayout
        title="Interview Session"
        subtitle="Preparing your practice session."
        currentPage={currentPage}
        onNavigate={onNavigate}
      >
        <LoadingState
          title="Loading interview questions"
          message="Finding questions that match your role, experience level, and practice goals."
        />
      </PageLayout>
    );
  }

  if (questionLoadError) {
    /*
    * A quota rejection is different
    * from a normal network/data error.
    *
    * Retrying the exact same request
    * would simply fail again, so send
    * the user back to setup where the
    * latest allowance can be loaded.
    */
    if (questionQuotaError) {
      const {
        remaining,
        limit,
      } = questionQuotaError;

      const quotaTitle =
        remaining <= 0
          ? "Daily question limit reached"
          : "Not enough questions remaining";

      const quotaMessage =
        remaining <= 0
          ? `You have used your daily Code + Theoretical question allowance${
              limit > 0
                ? ` of ${limit} questions`
                : ""
            }. Return to Interview Setup to choose another mode or wait for the daily reset.`
          : `Your daily allowance changed before this session began. You now have ${remaining} Code + Theoretical question${
              remaining === 1
                ? ""
                : "s"
            } remaining today. Return to Interview Setup and choose a session of ${remaining} question${
              remaining === 1
                ? ""
                : "s"
            } or fewer.`;

      return (
        <PageLayout
          title="Interview Session"
          subtitle="Your daily allowance changed."
          currentPage={currentPage}
          onNavigate={onNavigate}
        >
          <ErrorState
            title={quotaTitle}
            message={quotaMessage}
            retry={
              handleReturnToSetup
            }
            retryLabel="Return to Interview Setup"
          />
        </PageLayout>
      );
    }

    return (
      <PageLayout
        title="Interview Session"
        subtitle="We could not start your session."
        currentPage={currentPage}
        onNavigate={onNavigate}
      >
        <ErrorState
          title="Questions could not be loaded"
          message={questionLoadError}
          retry={loadQuestions}
          retryLabel="Retry Question Load"
        />
      </PageLayout>
    );
  }

  if (
    !currentQuestion
  ) {
    return null;
  }

  return (
    <PageLayout
      title="Interview Session"
      subtitle={`${modeDetails.label} practice session`}
      currentPage={
        currentPage
      }
      onNavigate={
        onNavigate
      }
    >
      <div className="interviewSessionShell">
        <section className="sessionMainColumn">
          {/* Session progress */}
          <div className="sessionProgressCard ib-card">
            <div className="sessionProgressTop">
              <div className="sessionModeIdentity">
                <div
                  className="sessionModeIcon"
                  aria-hidden="true"
                >
                  {
                    modeDetails.icon
                  }
                </div>

                <div>
                  <span className="sessionStatusBadge">
                    Active Session
                  </span>

                  <h2>
                    {
                      modeDetails.label
                    }
                  </h2>

                  <p>
                    {
                      modeDetails.description
                    }
                  </p>
                </div>
              </div>

              <div className="sessionQuestionPosition">
                <strong>
                  Question{" "}
                  {
                    currentQuestionNumber
                  }{" "}
                  of{" "}
                  {
                    questionCount
                  }
                </strong>

                <span>
                  {
                    progressPercent
                  }
                  % complete
                </span>
              </div>
            </div>

            <div
              className="ib-progress-track"
              role="progressbar"
              aria-label="Interview progress"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={
                progressPercent
              }
            >
              <div
                className="ib-progress-fill"
                style={{
                  width:
                    `${progressPercent}%`,
                }}
              />
            </div>
          </div>

          {/* Question */}
          <article
            className="sessionQuestionCard ib-card"
            aria-busy={isSubmitting}
          >
            <div className="sessionQuestionHeader">
              <div>
                <span className="ib-eyebrow">
                  Question{" "}
                  {
                    currentQuestionNumber
                  }
                </span>

                <h2>
                  Interview
                  Question
                </h2>
              </div>

              {currentQuestion.difficulty && (
                <span className="sessionDifficultyBadge">
                  {
                    currentQuestion.difficulty
                  }
                </span>
              )}
            </div>

            <p className="sessionQuestionPrompt">
              {
                currentQuestion.prompt
              }
            </p>

            {currentQuestion.topic && (
              <div className="sessionQuestionTopic">
                <span>
                  Topic
                </span>

                <strong>
                  {
                    currentQuestion.topic
                  }
                </strong>
              </div>
            )}

            <div className="sessionAnswerArea">
              {isQuiz
                ? renderQuizAnswerArea()
                : renderWrittenAnswerArea()}
            </div>

            {submissionError && (
              <div
                className="sessionSubmissionError"
                role="alert"
              >
                {submissionError}
              </div>
            )}

            {isSubmitting && (
              <SubmittingState
                message={submissionMessage}
              />
            )}

            {renderQuizFeedback()}

            {renderAiFeedback()}

            <div className="sessionQuestionActions">
              {endSessionError && (
                <div role="alert" className="sessionError">
                  <p>{endSessionError}</p>

                  {!canRetryEndSession && (
                    <button
                      type="button"
                      className="ib-button ib-button--primary"
                      onClick={() => onNavigate(PAGES.INTERVIEW_SETUP)}
                    >
                      Start New Session
                    </button>
                  )}
                </div>
              )}

              <button
                type="button"
                className="ib-button ib-button--secondary"
                onClick={handleEndInterview}
                disabled={isSubmitting || isEndingSession}
              >
                {isEndingSession ? "Ending Session..." : "End Interview"}
              </button>

              <div className="sessionPrimaryActions">
                {!evaluationResult && (
                  <button
                    type="button"
                    className="ib-button ib-button--primary"
                    onClick={
                      handleSubmit
                    }
                    disabled={
                      isSubmitting
                    }
                  >
                    {isSubmitting
                      ? submissionMessage
                      : "Submit"}
                  </button>
                )}

                {evaluationResult &&
                  currentQuestionIndex <
                    questions.length -
                      1 && (
                    <button
                      type="button"
                      className="ib-button ib-button--primary"
                      onClick={
                        handleNextQuestion
                      }
                    >
                      Next Question
                    </button>
                  )}

                {evaluationResult &&
                  currentQuestionIndex ===
                    questions.length -
                      1 && (
                    <button
                      type="button"
                      className="ib-button ib-button--primary"
                      onClick={handleEndInterview}
                      disabled={isSubmitting || isEndingSession}
                    >
                      {isEndingSession ? "Ending Session..." : "Finish Session"}
                    </button>
                  )}
              </div>
            </div>
          </article>
        </section>

        {/* Right-side session summary */}
        <aside className="sessionSideColumn">
          <section className="sessionPerformanceCard ib-card">
            <span className="ib-eyebrow">
              Performance
            </span>

            <h2>
              Session Progress
            </h2>

            <div className="sessionMetricGrid">
              <div className="sessionMetric">
                <span>
                  Answered
                </span>

                <strong>
                  {
                    answeredQuestions.length
                  }
                  /
                  {
                    questionCount
                  }
                </strong>
              </div>

              <div className="sessionMetric">
                <span>
                  Score
                </span>

                <strong>
                  {
                    currentAverageScore
                  }
                  %
                </strong>
              </div>
            </div>

            <div className="sessionDetailList">
              <div className="sessionDetailItem">
                <span>
                  Mode
                </span>

                <strong>
                  {
                    modeDetails.label
                  }
                </strong>
              </div>

              <div className="sessionDetailItem">
                <span>
                  Role
                </span>

                <strong>
                  {setupData?.jobRole ||
                    "—"}
                </strong>
              </div>

              <div className="sessionDetailItem">
                <span>
                  Experience
                </span>

                <strong>
                  {setupData?.experienceLevel ||
                    "—"}
                </strong>
              </div>
            </div>
          </section>

          <section className="sessionFocusCard ib-card">
            <span className="ib-eyebrow">
              Practice Focus
            </span>

            <div className="sessionFocusTags">
              {Array.isArray(
                setupData?.tags
              ) &&
              setupData.tags.length >
                0 ? (
                setupData.tags.map(
                  (tag) => (
                    <span
                      key={
                        tag
                      }
                      className="sessionFocusTag"
                    >
                      {
                        tag
                      }
                    </span>
                  )
                )
              ) : (
                <p>
                  No practice goals
                  selected.
                </p>
              )}
            </div>
          </section>
        </aside>
      </div>
    </PageLayout>
  );
}

export default InterviewSessionPage;