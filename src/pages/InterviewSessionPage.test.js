import React from "react";

import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import userEvent from "@testing-library/user-event";

import InterviewSessionPage from "./InterviewSessionPage";

import {
  aiService,
  interviewService,
} from "../services";

import { PAGES } from "../utils/constants";


/* ============================================================
   MOCKS
   ============================================================ */

jest.mock(
  "../components/layout/PageLayout",
  () => {
    return function MockPageLayout({
      children,
    }) {
      return (
        <div>
          {children}
        </div>
      );
    };
  }
);


jest.mock("../services", () => ({
  aiService: {
    evaluateAnswer:
      jest.fn(),
  },

  interviewService: {
    getQuestions:
      jest.fn(),

    checkQuizAnswer:
      jest.fn(),

    endSession:
      jest.fn(),
  },
}));

jest.mock(
  "../components/interview/CodeEditor",
  () => {
    return function MockCodeEditor({
      value,
      onChange,
      language,
      disabled,
      ariaLabel =
        "Your Response",
    }) {
      return (
        <textarea
          aria-label={
            ariaLabel
          }

          data-language={
            language
          }

          value={
            value
          }

          disabled={
            disabled
          }

          onChange={(event) => {
            onChange(
              event.target.value
            );
          }}
        />
      );
    };
  }
);


/* ============================================================
   TEST SUITE
   ============================================================ */

describe(
  "InterviewSessionPage",
  () => {
    /* ========================================================
       SHARED TEST DATA
       ======================================================== */

    const defaultSetupData = {
      id:
        "mock-session-1",

      jobRole:
        "Software Engineer",

      experienceLevel:
        "Intermediate",

      tags: [
        "algorithms",
      ],

      questionCount:
        10,
    };


    const quizQuestion = {
      id:
        "quiz-test-001",

      mode:
        "Quiz Style",

      prompt:
        "Which data structure uses FIFO ordering?",

      options: [
        "Queue",
        "Stack",
        "Tree",
        "Heap",
      ],

      topic:
        "Data Structures",

      difficulty:
        "Beginner",
    };


    const secondQuizQuestion = {
      id:
        "quiz-test-002",

      mode:
        "Quiz Style",

      prompt:
        "Which data structure uses LIFO ordering?",

      options: [
        "Queue",
        "Stack",
        "Graph",
        "Tree",
      ],

      topic:
        "Data Structures",

      difficulty:
        "Beginner",
    };


    const codeQuestion = {
      id:
        "code-test-001",

      mode:
        "Code Style",

      prompt:
        "Write a function that reverses an array.",

      options: [],

      topic:
        "Arrays",

      difficulty:
        "Beginner",
    };


    const theoreticalQuestion = {
      id:
        "theoretical-test-001",

      mode:
        "Theoretical Style",

      prompt:
        "Explain the difference between authentication and authorization.",

      options: [],

      topic:
        "Security",

      difficulty:
        "Intermediate",
    };


    let onNavigate;
    let onEndInterview;


    /* ========================================================
       TEST SETUP
       ======================================================== */

    beforeEach(() => {
      jest.clearAllMocks();

      onNavigate =
        jest.fn();

      onEndInterview =
        jest.fn();


      /*
       * Code Style is the default question.
       *
       * Quiz and Theoretical tests override
       * this when needed.
       */
      interviewService
        .getQuestions
        .mockResolvedValue([
          codeQuestion,
        ]);


      /*
       * Default Quiz result.
       */
      interviewService
        .checkQuizAnswer
        .mockResolvedValue({
          isCorrect:
            true,

          explanation:
            "A queue processes items in first-in, first-out order.",

          correctAnswer:
            "Queue",
        });


      /*
       * Default AI result used for both
       * Code and Theoretical responses.
       */
      aiService
        .evaluateAnswer
        .mockResolvedValue({
          score:
            88,

          feedback:
            "Correct approach with a minor explanation gap.",

          strengths: [
            "Correct logic",
          ],

          weaknesses: [
            "Brief explanation",
          ],

          suggestions: [
            "Mention complexity",
          ],

          criterionResults: [
            {
              name:
                "Correctness",

              awardedPoints:
                53,

              maxPoints:
                60,

              feedback:
                "Correct.",
            },
          ],
        });
    });


    /* ========================================================
       HELPERS
       ======================================================== */

    function renderPage({
      selectedMode =
        "Code Style",

      setupData =
        defaultSetupData,

      endInterview =
        onEndInterview,

      navigate =
        onNavigate,
    } = {}) {
      render(
        <InterviewSessionPage
          currentPage={
            PAGES.INTERVIEW
          }
          onNavigate={
            navigate
          }
          selectedMode={
            selectedMode
          }
          setupData={
            setupData
          }
          onEndInterview={
            endInterview
          }
        />
      );
    }


    async function loadQuizSession(
      questions = [
        quizQuestion,
      ]
    ) {
      interviewService
        .getQuestions
        .mockResolvedValue(
          questions
        );


      renderPage({
        selectedMode:
          "Quiz Style",
      });


      expect(
        await screen.findByText(
          "Which data structure uses FIFO ordering?"
        )
      ).toBeInTheDocument();
    }


    async function selectQueueAnswer() {
      const queueOption =
        screen.getByRole(
          "radio",
          {
            name:
              /queue/i,
          }
        );


      userEvent.click(
        queueOption
      );


      await waitFor(() => {
        expect(
          queueOption
        ).toBeChecked();
      });
    }


    async function submitQuizAnswer() {
      userEvent.click(
        screen.getByRole(
          "button",
          {
            name:
              "Submit",
          }
        )
      );


      await waitFor(() => {
        expect(
          interviewService
            .checkQuizAnswer
        ).toHaveBeenCalled();
      });
    }

    function createDeferredPromise() {
      let resolve;
      let reject;

      const promise =
        new Promise(
          (resolvePromise, rejectPromise) => {
            resolve = resolvePromise;
            reject = rejectPromise;
          }
        );

      return {
        promise,
        resolve,
        reject,
      };
    }


    /* ========================================================
       QUESTION LOADING
       ======================================================== */

    test(
      "loads questions using the setup configuration",
      async () => {
        const setupData = {
          ...defaultSetupData,

          questionCount:
            20,
        };


        renderPage({
          selectedMode:
            "Code Style",

          setupData,
        });


        expect(
          await screen.findByText(
            "Write a function that reverses an array."
          )
        ).toBeInTheDocument();


        expect(
          interviewService
            .getQuestions
        ).toHaveBeenCalledWith({
          sessionId:
            "mock-session-1",
          mode:
            "Code Style",

          jobRole:
            "Software Engineer",

          experienceLevel:
            "Intermediate",

          tags: [
            "algorithms",
          ],

          limit:
            20,
        });
      }
    );


    /* ========================================================
       QUIZ STYLE
       ======================================================== */

    test(
      "starts the session progress at zero before any question is answered",
      async () => {
        await loadQuizSession([
          quizQuestion,
          secondQuizQuestion,
        ]);


        expect(
          screen.getByText(
            /question\s+1\s+of\s+2/i
          )
        ).toBeInTheDocument();


        expect(
          screen.getByText(
            "0% complete"
          )
        ).toBeInTheDocument();


        const progressBar =
          screen.getByRole(
            "progressbar",
            {
              name:
                "Interview progress",
            }
          );


        expect(
          progressBar
        ).toHaveAttribute(
          "aria-valuenow",
          "0"
        );
      }
    );


    test(
      "does not allow a quiz question to be submitted without an answer",
      async () => {
        await loadQuizSession();


        userEvent.click(
          screen.getByRole(
            "button",
            {
              name:
                "Submit",
            }
          )
        );


        expect(
          screen.getByText(
            "Please select an answer before submitting."
          )
        ).toBeInTheDocument();


        expect(
          interviewService
            .checkQuizAnswer
        ).not.toHaveBeenCalled();
      }
    );


    test(
      "submits the selected quiz answer through interviewService",
      async () => {
        await loadQuizSession();


        await selectQueueAnswer();


        userEvent.click(
          screen.getByRole(
            "button",
            {
              name:
                "Submit",
            }
          )
        );


        await waitFor(() => {  
          expect(
            interviewService.checkQuizAnswer
          ).toHaveBeenCalledWith(
            "quiz-test-001",
            "Queue",
            "mock-session-1"
          );
        });


        expect(
          await screen.findByText(
            "Correct Answer"
          )
        ).toBeInTheDocument();


        expect(
          screen.getByText(
            /first-in, first-out/i
          )
        ).toBeInTheDocument();
      }
    );


    test(
      "updates progress only after a question has been answered",
      async () => {
        await loadQuizSession([
          quizQuestion,
          secondQuizQuestion,
        ]);


        const progressBar =
          screen.getByRole(
            "progressbar",
            {
              name:
                "Interview progress",
            }
          );


        expect(
          progressBar
        ).toHaveAttribute(
          "aria-valuenow",
          "0"
        );


        expect(
          screen.getByText(
            "0% complete"
          )
        ).toBeInTheDocument();


        await selectQueueAnswer();

        await submitQuizAnswer();


        await waitFor(() => {
          expect(
            progressBar
          ).toHaveAttribute(
            "aria-valuenow",
            "50"
          );
        });


        expect(
          screen.getByText(
            "50% complete"
          )
        ).toBeInTheDocument();


        userEvent.click(
          screen.getByRole(
            "button",
            {
              name:
                "Next Question",
            }
          )
        );


        expect(
          screen.getByText(
            "Which data structure uses LIFO ordering?"
          )
        ).toBeInTheDocument();


        expect(
          screen.getByText(
            /question\s+2\s+of\s+2/i
          )
        ).toBeInTheDocument();


        expect(
          progressBar
        ).toHaveAttribute(
          "aria-valuenow",
          "50"
        );


        expect(
          screen.getByText(
            "50% complete"
          )
        ).toBeInTheDocument();
      }
    );


    test(
      "moves to the next quiz question after the current question is answered",
      async () => {
        await loadQuizSession([
          quizQuestion,
          secondQuizQuestion,
        ]);


        await selectQueueAnswer();

        await submitQuizAnswer();


        expect(
          await screen.findByRole(
            "button",
            {
              name:
                "Next Question",
            }
          )
        ).toBeInTheDocument();


        userEvent.click(
          screen.getByRole(
            "button",
            {
              name:
                "Next Question",
            }
          )
        );


        expect(
          screen.getByText(
            "Which data structure uses LIFO ordering?"
          )
        ).toBeInTheDocument();


        expect(
          screen.getByText(
            /question\s+2\s+of\s+2/i
          )
        ).toBeInTheDocument();


        expect(
          screen.getByRole(
            "radio",
            {
              name:
                /stack/i,
            }
          )
        ).not.toBeChecked();
      }
    );


    test(
      "generates quiz results from answered questions when the interview ends",
      async () => {
        interviewService.endSession.mockResolvedValue({
          id: "session-123",
          status: "completed",
          completedAt: "2026-10-13T12:00:00.000Z",
        });

        await loadQuizSession();


        await selectQueueAnswer();

        await submitQuizAnswer();


        expect(
          await screen.findByText(
            "Correct Answer"
          )
        ).toBeInTheDocument();


        await waitFor(() => {
          expect(
            screen.getByText(
              "1/1"
            )
          ).toBeInTheDocument();
        });


        userEvent.click(
          screen.getByRole(
            "button",
            {
              name:
                "End Interview",
            }
          )
        );

        await waitFor(() => {
          expect(
            onEndInterview
          ).toHaveBeenCalledWith(
            expect.objectContaining({
              mode:
                "Quiz Style",

              score:
                "100%",

              questionsAnswered:
                1,

              eloChange:
                "+2",

              isCorrect:
                true,

              answerSubmitted:
                true,

              jobRole:
                "Software Engineer",

              experienceLevel:
                "Intermediate",

              tags: [
                "algorithms",
              ],

              perQuestion: [
                expect.objectContaining({
                  questionId:
                    "quiz-test-001",

                  userAnswer:
                    "Queue",

                  isCorrect:
                    true,

                  score:
                    100,
                }),
              ],
            })
          );
        });

        expect(interviewService.endSession).toHaveBeenCalledTimes(1);
        expect(interviewService.endSession).toHaveBeenCalledWith(
          "mock-session-1"
        );
      }
    );


    /* ========================================================
       QUESTION LOADING ERRORS
       ======================================================== */

    test(
      "shows an error when no matching questions are returned",
      async () => {
        interviewService
          .getQuestions
          .mockResolvedValue(
            []
          );


        renderPage({
          selectedMode:
            "Quiz Style",
        });


        expect(
          await screen.findByText(
            "No active Quiz Style questions were returned from Firebase."
          )
        ).toBeInTheDocument();


        expect(
          screen.getByRole(
            "button",
            {
              name:
                "Retry Question Load",
            }
          )
        ).toBeInTheDocument();
      }
    );


    test(
      "allows question loading to be retried after an error",
      async () => {
        interviewService
          .getQuestions
          .mockRejectedValueOnce(
            new Error(
              "Firebase unavailable."
            )
          )
          .mockResolvedValueOnce([
            quizQuestion,
          ]);


        renderPage({
          selectedMode:
            "Quiz Style",
        });


        expect(
          await screen.findByText(
            "Firebase unavailable."
          )
        ).toBeInTheDocument();


        userEvent.click(
          screen.getByRole(
            "button",
            {
              name:
                "Retry Question Load",
            }
          )
        );


        expect(
          await screen.findByText(
            "Which data structure uses FIFO ordering?"
          )
        ).toBeInTheDocument();


        expect(
          interviewService
            .getQuestions
        ).toHaveBeenCalledTimes(
          2
        );
      }
    );

    test(
      "shows a quota-specific error when the daily allowance changes before questions load",
      async () => {
        const quotaError =
          new Error(
            "Daily AI question limit exceeded. 2 questions remain today."
          );

        quotaError.code =
          "daily-question-limit-exceeded";

        quotaError.status =
          429;

        quotaError.quota = {
          limit: 20,
          used: 18,
          requested: 10,
          remaining: 2,
        };

        interviewService
          .getQuestions
          .mockRejectedValue(
            quotaError
          );

        renderPage({
          selectedMode:
            "Code Style",
        });

        expect(
          await screen.findByRole(
            "heading",
            {
              name:
                "Not enough questions remaining",
            }
          )
        ).toBeInTheDocument();

        expect(
          screen.getByText(
            /you now have 2 code \+ theoretical questions remaining today/i
          )
        ).toBeInTheDocument();

        expect(
          screen.getByRole(
            "button",
            {
              name:
                "Return to Interview Setup",
            }
          )
        ).toBeInTheDocument();

        expect(
          screen.queryByRole(
            "button",
            {
              name:
                "Retry Question Load",
            }
          )
        ).not.toBeInTheDocument();
      }
    );
    test(
  "returns to Interview Setup after a quota loading error",
  async () => {
    const quotaError =
      new Error(
        "Daily AI question limit exceeded. 3 questions remain today."
      );

    quotaError.code =
      "daily-question-limit-exceeded";

    quotaError.status =
      429;

    quotaError.quota = {
      limit: 20,
      used: 17,
      requested: 10,
      remaining: 3,
    };

    interviewService
      .getQuestions
      .mockRejectedValue(
        quotaError
      );

    renderPage({
      selectedMode:
        "Theoretical Style",
    });

    userEvent.click(
      await screen.findByRole(
        "button",
        {
          name:
            "Return to Interview Setup",
        }
      )
    );

    expect(
      onNavigate
    ).toHaveBeenCalledWith(
      PAGES.INTERVIEW_SETUP
    );

    /*
     * A quota error should not retry
     * the stale question request.
     */
    expect(
      interviewService
        .getQuestions
    ).toHaveBeenCalledTimes(
      1
    );
  }
);
test(
  "shows daily limit reached when no counted questions remain",
  async () => {
    const quotaError =
      new Error(
        "Daily AI question limit exceeded. 0 questions remain today."
      );

    quotaError.code =
      "daily-question-limit-exceeded";

    quotaError.status =
      429;

    quotaError.quota = {
      limit: 20,
      used: 20,
      requested: 5,
      remaining: 0,
    };

    interviewService
      .getQuestions
      .mockRejectedValue(
        quotaError
      );

    renderPage({
      selectedMode:
        "Code Style",
    });

    expect(
      await screen.findByRole(
        "heading",
        {
          name:
            "Daily question limit reached",
        }
      )
    ).toBeInTheDocument();

    expect(
      screen.getByText(
        /used your daily code \+ theoretical question allowance of 20 questions/i
      )
    ).toBeInTheDocument();
  }
);

    /* ========================================================
    SCRUM-58 — ASYNC SUBMISSION UX
    ======================================================== */

    test(
      "shows a Quiz checking state while the answer is being processed",
      async () => {
        const deferred =
          createDeferredPromise();

        interviewService
          .checkQuizAnswer
          .mockReturnValue(
            deferred.promise
          );

        await loadQuizSession();

        await selectQueueAnswer();

        const submitButton =
          screen.getByRole(
            "button",
            {
              name:
                "Submit",
            }
          );

        userEvent.click(
          submitButton
        );

        await waitFor(() => {
          expect(
            interviewService.checkQuizAnswer
          ).toHaveBeenCalledWith(
            "quiz-test-001",
            "Queue",
            "mock-session-1"
          );
        });

        expect(
          screen.getByRole(
            "status"
          )
        ).toHaveTextContent(
          "Checking answer..."
        );

        expect(
          submitButton
        ).toBeDisabled();

        expect(
          screen.getByRole(
            "radio",
            {
              name:
                /queue/i,
            }
          )
        ).toBeDisabled();

        deferred.resolve({
          isCorrect:
            true,

          explanation:
            "A queue processes items in first-in, first-out order.",

          correctAnswer:
            "Queue",
        });

        expect(
          await screen.findByText(
            "Correct Answer"
          )
        ).toBeInTheDocument();
      }
    );


    test(
      "shows a Code evaluation state while the solution is being processed",
      async () => {
        const deferred =
          createDeferredPromise();

        aiService
          .evaluateAnswer
          .mockReturnValue(
            deferred.promise
          );

        renderPage({
          selectedMode:
            "Code Style",
        });

        await screen.findByText(
          "Write a function that reverses an array."
        );

        const responseInput =
          screen.getByLabelText(
            "Your Response"
          );

        const languageSelect =
          screen.getByRole(
            "combobox",
            {
              name:
                "Programming Language",
            }
          );

        fireEvent.change(
          responseInput,
          {
            target: {
              value:
                "function reverse(arr) { return arr.reverse(); }",
            },
          }
        );

        const submitButton =
          screen.getByRole(
            "button",
            {
              name:
                "Submit",
            }
          );

        userEvent.click(
          submitButton
        );

        await waitFor(() => {
          expect(
            aiService
              .evaluateAnswer
          ).toHaveBeenCalled();
        });

        expect(
          screen.getByRole(
            "status"
          )
        ).toHaveTextContent(
          "Evaluating solution..."
        );

        expect(
          submitButton
        ).toBeDisabled();

        expect(
          responseInput
        ).toBeDisabled();

        expect(
          languageSelect
        ).toBeDisabled();

        deferred.resolve({
          score:
            88,

          feedback:
            "Correct approach with a minor explanation gap.",

          strengths: [
            "Correct logic",
          ],

          weaknesses: [
            "Brief explanation",
          ],

          suggestions: [
            "Mention complexity",
          ],

          criterionResults: [],
        });

        expect(
          await screen.findByText(
            /Score:\s*88\/100/i
          )
        ).toBeInTheDocument();
      }
    );


    test(
      "shows a Theoretical evaluation state while the response is being processed",
      async () => {
        const deferred =
          createDeferredPromise();

        interviewService
          .getQuestions
          .mockResolvedValue([
            theoreticalQuestion,
          ]);

        aiService
          .evaluateAnswer
          .mockReturnValue(
            deferred.promise
          );

        renderPage({
          selectedMode:
            "Theoretical Style",
        });

        await screen.findByText(
          "Explain the difference between authentication and authorization."
        );

        const responseInput =
          screen.getByLabelText(
            "Your Response"
          );

        userEvent.type(
          responseInput,
          "Authentication confirms identity while authorization controls permissions."
        );

        const submitButton =
          screen.getByRole(
            "button",
            {
              name:
                "Submit",
            }
          );

        userEvent.click(
          submitButton
        );

        await waitFor(() => {
          expect(
            aiService
              .evaluateAnswer
          ).toHaveBeenCalled();
        });

        expect(
          screen.getByRole(
            "status"
          )
        ).toHaveTextContent(
          "Evaluating response..."
        );

        expect(
          submitButton
        ).toBeDisabled();

        expect(
          responseInput
        ).toBeDisabled();

        deferred.resolve({
          score:
            88,

          feedback:
            "Correct approach with a minor explanation gap.",

          strengths: [
            "Correct logic",
          ],

          weaknesses: [
            "Brief explanation",
          ],

          suggestions: [
            "Mention complexity",
          ],

          criterionResults: [],
        });

        expect(
          await screen.findByText(
            /Score:\s*88\/100/i
          )
        ).toBeInTheDocument();
      }
    );


    test(
      "prevents duplicate submissions while evaluation is in progress",
      async () => {
        const deferred =
          createDeferredPromise();

        aiService
          .evaluateAnswer
          .mockReturnValue(
            deferred.promise
          );

        renderPage({
          selectedMode:
            "Code Style",
        });

        await screen.findByText(
          "Write a function that reverses an array."
        );

        fireEvent.change(
          screen.getByLabelText(
            "Your Response"
          ),
          {
            target: {
              value:
                "reverse the array using a loop",
            },
          }
        );

        const submitButton =
          screen.getByRole(
            "button",
            {
              name:
                "Submit",
            }
          );

        userEvent.click(
          submitButton
        );

        await waitFor(() => {
          expect(
            aiService
              .evaluateAnswer
          ).toHaveBeenCalledTimes(
            1
          );
        });

        expect(
          submitButton
        ).toBeDisabled();

        userEvent.click(
          submitButton
        );

        expect(
          aiService
            .evaluateAnswer
        ).toHaveBeenCalledTimes(
          1
        );

        deferred.resolve({
          score:
            88,

          feedback:
            "Correct approach with a minor explanation gap.",

          strengths: [
            "Correct logic",
          ],

          weaknesses: [
            "Brief explanation",
          ],

          suggestions: [
            "Mention complexity",
          ],

          criterionResults: [],
        });

        expect(
          await screen.findByText(
            /Score:\s*88\/100/i
          )
        ).toBeInTheDocument();

        expect(
          aiService
            .evaluateAnswer
        ).toHaveBeenCalledTimes(
          1
        );
      }
    );
    /* ========================================================
       CODE STYLE
       ======================================================== */

    test(
      "submits Code Style answers through aiService",
      async () => {
        renderPage({
          selectedMode:
            "Code Style",
        });


        expect(
          await screen.findByText(
            "Write a function that reverses an array."
          )
        ).toBeInTheDocument();


        /*
         * Use the accessible label rather
         * than the placeholder because the
         * Code UI now has a custom placeholder.
         */
        userEvent.type(
          screen.getByLabelText(
            "Your Response"
          ),
          "reverse the array with a loop"
        );


        userEvent.click(
          screen.getByRole(
            "button",
            {
              name:
                "Submit",
            }
          )
        );


        await waitFor(() => {
          expect(
            aiService
              .evaluateAnswer
          ).toHaveBeenCalledWith({
            questionId:
              "code-test-001",

            userAnswer:
              "reverse the array with a loop",

            sessionId:
              "mock-session-1",

            jobRole:
              "Software Engineer",

            experienceLevel:
              "Intermediate",
          });
        });


        expect(
          await screen.findByText(
            /Score:\s*88\/100/i
          )
        ).toBeInTheDocument();


        expect(
          screen.getByText(
            "Correct approach with a minor explanation gap."
          )
        ).toBeInTheDocument();


        expect(
          screen.getByText(
            "Correct logic"
          )
        ).toBeInTheDocument();
      }
    );


    test(
      "allows an AI answer to be retried when evaluation fails",
      async () => {
        aiService
          .evaluateAnswer
          .mockRejectedValue(
            new Error(
              "AI evaluation unavailable."
            )
          );


        renderPage({
          selectedMode:
            "Code Style",
        });


        expect(
          await screen.findByText(
            "Write a function that reverses an array."
          )
        ).toBeInTheDocument();


        userEvent.type(
          screen.getByLabelText(
            "Your Response"
          ),
          "my attempted answer"
        );


        userEvent.click(
          screen.getByRole(
            "button",
            {
              name:
                "Submit",
            }
          )
        );


        expect(
          await screen.findByText(
            "AI evaluation unavailable."
          )
        ).toBeInTheDocument();


        expect(
          screen.getByText(
            "0% complete"
          )
        ).toBeInTheDocument();


        expect(
          screen.getByRole(
            "button",
            {
              name:
                "Submit",
            }
          )
        ).toBeEnabled();


        expect(
          screen.queryByRole(
            "button",
            {
              name:
                "Next Question",
            }
          )
        ).not.toBeInTheDocument();
      }
    );


    test(
      "shows the Code Style response workspace with Python selected by default",
      async () => {
        renderPage({
          selectedMode:
            "Code Style",
        });


        expect(
          await screen.findByText(
            "Write a function that reverses an array."
          )
        ).toBeInTheDocument();


        expect(
          screen.getByText(
            "Code Response"
          )
        ).toBeInTheDocument();


        expect(
          screen.getByText(
            "Approach"
          )
        ).toBeInTheDocument();


        expect(
          screen.getByText(
            "Implementation"
          )
        ).toBeInTheDocument();


        expect(
          screen.getByText(
            "Complexity"
          )
        ).toBeInTheDocument();


        expect(
          screen.getByRole(
            "combobox",
            {
              name:
                "Programming Language",
            }
          )
        ).toHaveValue(
          "python"
        );


        expect(
          screen.getByLabelText(
            "Your Response"
          )
        ).toHaveAttribute(
          "data-language",
          "python"
        );
      }
    );

    test(
      "allows the user to change the Code Style programming language",
      async () => {
        renderPage({
          selectedMode:
            "Code Style",
        });


        await screen.findByText(
          "Write a function that reverses an array."
        );


        const languageSelect =
          screen.getByRole(
            "combobox",
            {
              name:
                "Programming Language",
            }
          );


        expect(
          languageSelect
        ).toHaveValue(
          "python"
        );


        userEvent.selectOptions(
          languageSelect,
          "javascript"
        );


        expect(
          languageSelect
        ).toHaveValue(
          "javascript"
        );


        expect(
          screen.getByLabelText(
            "Your Response"
          )
        ).toHaveAttribute(
          "data-language",
          "javascript"
        );
      }
    );


    test(
      "automatically selects PostgreSQL for SQL questions",
      async () => {
        interviewService.getQuestions.mockResolvedValue([
          {
            ...codeQuestion,
            id: "sql-test-001",
            prompt: "SQL dialect: PostgreSQL. Return top customers.",
            topic: "SQL",
            tags: ["database", "SQL"],
          },
        ]);

        renderPage();

        await screen.findByText(
          "SQL dialect: PostgreSQL. Return top customers."
        );

        await waitFor(() => {
          expect(
            screen.getByRole("combobox", {
              name: "Programming Language",
            })
          ).toHaveValue("sql");
        });

        expect(screen.getByLabelText("Your Response"))
          .toHaveAttribute("data-language", "sql");
      }
    );

    test(
      "automatically selects JavaScript for JavaScript questions",
      async () => {
        interviewService.getQuestions.mockResolvedValue([
          {
            ...codeQuestion,
            id: "javascript-test-001",
            prompt: "Task (JavaScript): Implement debounce(fn, waitMs).",
            topic: "JavaScript",
            tags: ["javascript", "async"],
          },
        ]);

        renderPage();

        await screen.findByText(
          "Task (JavaScript): Implement debounce(fn, waitMs)."
        );

        await waitFor(() => {
          expect(screen.getByRole("combobox", {
            name: "Programming Language",
          })).toHaveValue("javascript");
        });

        expect(screen.getByLabelText("Your Response"))
          .toHaveAttribute("data-language", "javascript");
      }
    );

    test(
      "detects explicit SQL language instructions without tags or topic",
      async () => {
        interviewService.getQuestions.mockResolvedValue([
          {
            ...codeQuestion,
            prompt: "SQL dialect: PostgreSQL. Query customers.",
            tags: [],
            topic: "Database queries",
          },
        ]);

        renderPage();
        await screen.findByText(
          "SQL dialect: PostgreSQL. Query customers."
        );

        await waitFor(() => {
          expect(screen.getByRole("combobox", {
            name: "Programming Language",
          })).toHaveValue("sql");
        });
      }
    );

    test(
      "preserves manual language selection on a question but resets on the next question",
      async () => {
        interviewService.getQuestions.mockResolvedValue([
          {
            ...codeQuestion,
            id: "sql-test-002",
            prompt: "SQL dialect: PostgreSQL. Query orders.",
            tags: ["sql"],
            topic: "SQL",
          },
          {
            ...codeQuestion,
            id: "js-test-002",
            prompt: "Task (JavaScript): Retry a promise.",
            tags: ["javascript"],
            topic: "JavaScript",
          },
          {
            ...codeQuestion,
            id: "generic-test-003",
            prompt: "Implement a binary search function.",
            tags: ["algorithms"],
            topic: "Algorithms",
          },
        ]);

        renderPage();

        await screen.findByText(
          "SQL dialect: PostgreSQL. Query orders."
        );
        const languageSelect = screen.getByRole("combobox", {
          name: "Programming Language",
        });
        await waitFor(() => {
          expect(languageSelect).toHaveValue("sql");
        });

        userEvent.selectOptions(languageSelect, "cpp");
        expect(languageSelect).toHaveValue("cpp");
        fireEvent.change(screen.getByLabelText("Your Response"), {
          target: { value: "SELECT 1;" },
        });
        expect(languageSelect).toHaveValue("cpp");

        userEvent.click(screen.getByRole("button", { name: "Submit" }));
        await screen.findByText("Response Feedback");
        userEvent.click(screen.getByRole("button", { name: "Next Question" }));

        await screen.findByText(
          "Task (JavaScript): Retry a promise."
        );
        await waitFor(() => {
          expect(languageSelect).toHaveValue("javascript");
        });

        fireEvent.change(screen.getByLabelText("Your Response"), {
          target: { value: "async function retry() {}" },
        });
        userEvent.click(screen.getByRole("button", { name: "Submit" }));
        await screen.findByText("Response Feedback");
        userEvent.click(screen.getByRole("button", { name: "Next Question" }));

        await screen.findByText("Implement a binary search function.");
        await waitFor(() => {
          expect(languageSelect).toHaveValue("python");
        });
      }
    );

    test(
      "requires a written response before submitting a Code question",
      async () => {
        renderPage({
          selectedMode:
            "Code Style",
        });


        await screen.findByText(
          "Write a function that reverses an array."
        );


        userEvent.click(
          screen.getByRole(
            "button",
            {
              name:
                "Submit",
            }
          )
        );


        expect(
          screen.getByText(
            "Please enter an answer before submitting."
          )
        ).toBeInTheDocument();


        expect(
          aiService
            .evaluateAnswer
        ).not.toHaveBeenCalled();
      }
    );


    test(
      "counts a Code question as complete only after AI evaluation succeeds",
      async () => {
        renderPage({
          selectedMode:
            "Code Style",
        });


        await screen.findByText(
          "Write a function that reverses an array."
        );


        const progressBar =
          screen.getByRole(
            "progressbar",
            {
              name:
                "Interview progress",
            }
          );


        expect(
          progressBar
        ).toHaveAttribute(
          "aria-valuenow",
          "0"
        );


        /*
         * fireEvent.change is used here
         * because userEvent.type interprets
         * { } as special keyboard syntax.
         */
        fireEvent.change(
          screen.getByLabelText(
            "Your Response"
          ),
          {
            target: {
              value:
                "function reverse(arr) { return arr.reverse(); }",
            },
          }
        );


        expect(
          screen.getByLabelText(
            "Your Response"
          )
        ).toHaveValue(
          "function reverse(arr) { return arr.reverse(); }"
        );


        userEvent.click(
          screen.getByRole(
            "button",
            {
              name:
                "Submit",
            }
          )
        );


        await waitFor(() => {
          expect(
            aiService
              .evaluateAnswer
          ).toHaveBeenCalledWith(
            expect.objectContaining({
              questionId:
                "code-test-001",

              userAnswer:
                "function reverse(arr) { return arr.reverse(); }",
            })
          );
        });


        await waitFor(() => {
          expect(
            progressBar
          ).toHaveAttribute(
            "aria-valuenow",
            "100"
          );
        });


        expect(
          screen.getByText(
            "100% complete"
          )
        ).toBeInTheDocument();


        expect(
          await screen.findByText(
            /Score:\s*88\/100/i
          )
        ).toBeInTheDocument();
      }
    );


    /* ========================================================
       THEORETICAL STYLE
       ======================================================== */

    test(
      "submits Theoretical Style answers through aiService",
      async () => {
        interviewService
          .getQuestions
          .mockResolvedValue([
            theoreticalQuestion,
          ]);


        renderPage({
          selectedMode:
            "Theoretical Style",
        });


        expect(
          await screen.findByText(
            "Explain the difference between authentication and authorization."
          )
        ).toBeInTheDocument();


        const response =
          "Authentication verifies who a user is, while authorization determines what that authenticated user is allowed to access.";


        userEvent.type(
          screen.getByLabelText(
            "Your Response"
          ),
          response
        );


        userEvent.click(
          screen.getByRole(
            "button",
            {
              name:
                "Submit",
            }
          )
        );


        await waitFor(() => {
          expect(
            aiService
              .evaluateAnswer
          ).toHaveBeenCalledWith({
            questionId:
              "theoretical-test-001",

            userAnswer:
              response,

            sessionId:
              "mock-session-1",

            jobRole:
              "Software Engineer",

            experienceLevel:
              "Intermediate",
          });
        });


        expect(
          await screen.findByText(
            /Score:\s*88\/100/i
          )
        ).toBeInTheDocument();


        expect(
          screen.getByText(
            "Correct approach with a minor explanation gap."
          )
        ).toBeInTheDocument();
      }
    );


    test(
      "requires a written answer before submitting a Theoretical question",
      async () => {
        interviewService
          .getQuestions
          .mockResolvedValue([
            theoreticalQuestion,
          ]);


        renderPage({
          selectedMode:
            "Theoretical Style",
        });


        await screen.findByText(
          "Explain the difference between authentication and authorization."
        );


        userEvent.click(
          screen.getByRole(
            "button",
            {
              name:
                "Submit",
            }
          )
        );


        expect(
          screen.getByText(
            "Please enter an answer before submitting."
          )
        ).toBeInTheDocument();


        expect(
          aiService
            .evaluateAnswer
        ).not.toHaveBeenCalled();
      }
    );


    test(
      "counts a Theoretical question as complete after AI evaluation succeeds",
      async () => {
        interviewService
          .getQuestions
          .mockResolvedValue([
            theoreticalQuestion,
          ]);


        renderPage({
          selectedMode:
            "Theoretical Style",
        });


        await screen.findByText(
          "Explain the difference between authentication and authorization."
        );


        expect(
          screen.getByText(
            "0% complete"
          )
        ).toBeInTheDocument();


        expect(
          screen.getByRole(
            "progressbar",
            {
              name:
                "Interview progress",
            }
          )
        ).toHaveAttribute(
          "aria-valuenow",
          "0"
        );


        userEvent.type(
          screen.getByLabelText(
            "Your Response"
          ),
          "Authentication confirms identity while authorization controls permissions."
        );


        userEvent.click(
          screen.getByRole(
            "button",
            {
              name:
                "Submit",
            }
          )
        );


        await waitFor(() => {
          expect(
            screen.getByRole(
              "progressbar",
              {
                name:
                  "Interview progress",
              }
            )
          ).toHaveAttribute(
            "aria-valuenow",
            "100"
          );
        });


        expect(
          screen.getByText(
            "100% complete"
          )
        ).toBeInTheDocument();


        expect(
          await screen.findByText(
            /Score:\s*88\/100/i
          )
        ).toBeInTheDocument();
      }
    );
  }
);