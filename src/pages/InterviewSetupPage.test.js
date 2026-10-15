import React from "react";

import {
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import userEvent from "@testing-library/user-event";

import InterviewSetupPage from "./InterviewSetupPage";

import {
  interviewService,
} from "../services";

import {
  PAGES,
} from "../utils/constants";

jest.mock(
  "../services/authService",
  () => ({
    authService: {
      logout: jest.fn(),
    },
  })
);

jest.mock(
  "../services",
  () => ({
    interviewService: {
      getSetupOptions:
        jest.fn(),

      getQuestionQuota:
        jest.fn(),

      startSession:
        jest.fn(),
    },
  })
);

/*
 * Prevent Firebase from initializing
 * during frontend unit tests.
 */
jest.mock(
  "../config/firebase",
  () => ({
    __esModule: true,

    auth: {
      currentUser: {
        uid: "test-user",
        email:
          "test@example.com",
      },
    },

    default: {},
  })
);

/*
 * These options represent the metadata
 * returned before the user has fully
 * configured the session.
 */
const baseSetupOptions = {
  jobRoles: [
    "backend developer",
    "frontend developer",
    "full stack developer",
    "software engineer",
  ],

  experienceLevels: [
    "Beginner",
    "Intermediate",
    "Experienced",
  ],

  tags: [],
};

/*
 * Practice goals are returned after both
 * a role and experience level have been
 * selected.
 */
const configuredSetupOptions = {
  jobRoles: [
    "backend developer",
    "frontend developer",
    "full stack developer",
    "software engineer",
  ],

  experienceLevels: [
    "Beginner",
    "Intermediate",
    "Experienced",
  ],

  tags: [
    "algorithms",
    "data structures",
    "testing",
    "tree",
  ],
};

const defaultQuota = {
  role: "user",

  unlimited: false,

  limit: 20,

  used: 0,

  remaining: 20,

  codeQuestionsUsed: 0,

  theoreticalQuestionsUsed: 0,

  dateKey:
    "2026-10-09",

  timeZone:
    "America/Los_Angeles",
};

describe(
  "InterviewSetupPage",
  () => {
    let onNavigate;
    let onStartInterview;

    beforeEach(() => {
      jest.clearAllMocks();

      onNavigate =
        jest.fn();

      onStartInterview =
        jest.fn();

      /*
       * The real page requests setup
       * options several times:
       *
       * 1. Mode only
       * 2. Mode + job role
       * 3. Mode + job role +
       *    experience level
       */
      interviewService
        .getSetupOptions
        .mockImplementation(
          async (
            mode,
            {
              jobRole = "",
              experienceLevel =
                "",
            } = {}
          ) => {
            if (
              jobRole &&
              experienceLevel
            ) {
              return configuredSetupOptions;
            }

            return baseSetupOptions;
          }
        );

      /*
       * Normal default quota.
       *
       * Quiz Style does not call this
       * method at all.
       */
      interviewService
        .getQuestionQuota
        .mockResolvedValue(
          defaultQuota
        );

      interviewService
        .startSession
        .mockResolvedValue({
          id:
            "mock-session-default",

          status:
            "active",
        });
    });

    function renderPage(
      selectedMode =
        "Quiz Style"
    ) {
      render(
        <InterviewSetupPage
          currentPage={
            PAGES.INTERVIEW_SETUP
          }
          onNavigate={
            onNavigate
          }
          selectedMode={
            selectedMode
          }
          onStartInterview={
            onStartInterview
          }
        />
      );
    }

    /*
     * Wait until the initial
     * setup-options request finishes.
     */
    async function waitForSetupOptions() {
      await waitFor(() => {
        expect(
          screen.getByLabelText(
            "Job Role"
          )
        ).toBeEnabled();
      });

      await waitFor(() => {
        expect(
          screen.getByLabelText(
            "Experience Level"
          )
        ).toBeEnabled();
      });

      await waitFor(() => {
        expect(
          screen.queryByText(
            /loading available setup options from firebase/i
          )
        ).not.toBeInTheDocument();
      });
    }

    /*
     * Wait until daily quota loading
     * has finished for Code or
     * Theoretical Style.
     */
    async function waitForQuota() {
      await waitFor(() => {
        expect(
          screen.queryByText(
            /checking your daily question allowance/i
          )
        ).not.toBeInTheDocument();
      });
    }

    /*
     * Select a Firebase-backed role.
     */
    async function selectSoftwareEngineer() {
      await waitForSetupOptions();

      const jobRoleInput =
        screen.getByLabelText(
          "Job Role"
        );

      userEvent.click(
        jobRoleInput
      );

      userEvent.click(
        screen.getByRole(
          "option",
          {
            name:
              "Software Engineer",
          }
        )
      );

      await waitFor(() => {
        expect(
          interviewService
            .getSetupOptions
        ).toHaveBeenCalledWith(
          expect.any(String),

          {
            jobRole:
              "Software Engineer",

            experienceLevel:
              "",
          }
        );
      });

      await waitFor(() => {
        expect(
          screen.getByLabelText(
            "Experience Level"
          )
        ).toBeEnabled();
      });

      await waitFor(() => {
        expect(
          screen.queryByText(
            /loading available setup options from firebase/i
          )
        ).not.toBeInTheDocument();
      });
    }

    /*
     * Selecting experience triggers
     * another options request.
     *
     * The practice-goal buttons then
     * become available.
     */
    async function selectIntermediateExperience() {
      userEvent.selectOptions(
        screen.getByLabelText(
          "Experience Level"
        ),

        "Intermediate"
      );

      await waitFor(() => {
        expect(
          interviewService
            .getSetupOptions
        ).toHaveBeenCalledWith(
          expect.any(String),

          {
            jobRole:
              "Software Engineer",

            experienceLevel:
              "Intermediate",
          }
        );
      });

      await waitFor(() => {
        expect(
          screen.getByRole(
            "button",
            {
              name:
                "Data Structures",
            }
          )
        ).toBeEnabled();
      });
    }

    /*
     * Complete all required setup
     * fields.
     */
    async function fillValidSetup() {
      await selectSoftwareEngineer();

      await selectIntermediateExperience();

      userEvent.click(
        screen.getByRole(
          "button",
          {
            name:
              "Data Structures",
          }
        )
      );
    }

    test(
      "displays the Interview Setup page",
      async () => {
        renderPage();

        expect(
          screen.getByRole(
            "heading",
            {
              name:
                "Interview Setup",
            }
          )
        ).toBeInTheDocument();

        await waitForSetupOptions();
      }
    );

    test(
      "displays the selected interview mode",
      async () => {
        renderPage(
          "Quiz Style"
        );

        expect(
          screen.getByText(
            "Selected Mode: Quiz Style"
          )
        ).toBeInTheDocument();

        await waitForSetupOptions();
      }
    );

    test(
      "loads setup options for the selected interview mode",
      async () => {
        renderPage(
          "Code Style"
        );

        await waitFor(() => {
          expect(
            interviewService
              .getSetupOptions
          ).toHaveBeenCalledWith(
            "Code Style",

            {
              jobRole: "",
              experienceLevel:
                "",
            }
          );
        });

        await waitForSetupOptions();

        const jobRoleInput =
          screen.getByLabelText(
            "Job Role"
          );

        userEvent.click(
          jobRoleInput
        );

        expect(
          screen.getByRole(
            "option",
            {
              name:
                "Software Engineer",
            }
          )
        ).toBeInTheDocument();

        expect(
          screen.getByRole(
            "option",
            {
              name:
                "Intermediate",
            }
          )
        ).toBeInTheDocument();
      }
    );

    test(
      "filters job roles while the user types",
      async () => {
        renderPage();

        await waitForSetupOptions();

        const jobRoleInput =
          screen.getByLabelText(
            "Job Role"
          );

        userEvent.click(
          jobRoleInput
        );

        expect(
          screen.getByRole(
            "option",
            {
              name:
                "Backend Developer",
            }
          )
        ).toBeInTheDocument();

        expect(
          screen.getByRole(
            "option",
            {
              name:
                "Frontend Developer",
            }
          )
        ).toBeInTheDocument();

        userEvent.type(
          jobRoleInput,
          "front"
        );

        expect(
          screen.getByRole(
            "option",
            {
              name:
                "Frontend Developer",
            }
          )
        ).toBeInTheDocument();

        expect(
          screen.queryByRole(
            "option",
            {
              name:
                "Backend Developer",
            }
          )
        ).not.toBeInTheDocument();

        expect(
          screen.queryByRole(
            "option",
            {
              name:
                "Software Engineer",
            }
          )
        ).not.toBeInTheDocument();
      }
    );

    test(
      "shows a message when no job roles match the search",
      async () => {
        renderPage();

        await waitForSetupOptions();

        userEvent.type(
          screen.getByLabelText(
            "Job Role"
          ),

          "astronaut"
        );

        expect(
          screen.getByText(
            "No matching job roles found."
          )
        ).toBeInTheDocument();
      }
    );

    test(
      "does not accept an arbitrary job role that was not selected from Firebase options",
      async () => {
        renderPage();

        await waitForSetupOptions();

        userEvent.type(
          screen.getByLabelText(
            "Job Role"
          ),

          "Game Developer"
        );

        userEvent.click(
          screen.getByRole(
            "button",
            {
              name:
                "Start Session",
            }
          )
        );

        expect(
          screen.getByText(
            "Please fill in all required fields before starting."
          )
        ).toBeInTheDocument();

        expect(
          interviewService
            .startSession
        ).not.toHaveBeenCalled();

        expect(
          onStartInterview
        ).not.toHaveBeenCalled();
      }
    );

    test(
      "reloads setup options after a job role is selected",
      async () => {
        renderPage(
          "Quiz Style"
        );

        await selectSoftwareEngineer();

        expect(
          interviewService
            .getSetupOptions
        ).toHaveBeenCalledWith(
          "Quiz Style",

          {
            jobRole:
              "Software Engineer",

            experienceLevel:
              "",
          }
        );
      }
    );

    test(
      "reloads practice goals after an experience level is selected",
      async () => {
        renderPage(
          "Quiz Style"
        );

        await selectSoftwareEngineer();

        await selectIntermediateExperience();

        expect(
          interviewService
            .getSetupOptions
        ).toHaveBeenCalledWith(
          "Quiz Style",

          {
            jobRole:
              "Software Engineer",

            experienceLevel:
              "Intermediate",
          }
        );

        expect(
          screen.getByRole(
            "button",
            {
              name:
                "Data Structures",
            }
          )
        ).toBeInTheDocument();
      }
    );

    test(
      "selects and deselects practice goal pills",
      async () => {
        renderPage();

        await selectSoftwareEngineer();

        await selectIntermediateExperience();

        const algorithmsButton =
          screen.getByRole(
            "button",
            {
              name:
                "Algorithms",
            }
          );

        const dataStructuresButton =
          screen.getByRole(
            "button",
            {
              name:
                "Data Structures",
            }
          );

        expect(
          algorithmsButton
        ).toHaveAttribute(
          "aria-pressed",
          "false"
        );

        userEvent.click(
          algorithmsButton
        );

        expect(
          algorithmsButton
        ).toHaveAttribute(
          "aria-pressed",
          "true"
        );

        expect(
          screen.getByText(
            "1 practice goal selected."
          )
        ).toBeInTheDocument();

        userEvent.click(
          dataStructuresButton
        );

        expect(
          dataStructuresButton
        ).toHaveAttribute(
          "aria-pressed",
          "true"
        );

        expect(
          screen.getByText(
            "2 practice goals selected."
          )
        ).toBeInTheDocument();

        userEvent.click(
          algorithmsButton
        );

        expect(
          algorithmsButton
        ).toHaveAttribute(
          "aria-pressed",
          "false"
        );

        expect(
          screen.getByText(
            "1 practice goal selected."
          )
        ).toBeInTheDocument();
      }
    );

    test(
      "does not start a session when required fields are empty",
      async () => {
        renderPage();

        await waitForSetupOptions();

        userEvent.click(
          screen.getByRole(
            "button",
            {
              name:
                "Start Session",
            }
          )
        );

        expect(
          screen.getByText(
            "Please fill in all required fields before starting."
          )
        ).toBeInTheDocument();

        expect(
          interviewService
            .startSession
        ).not.toHaveBeenCalled();

        expect(
          onStartInterview
        ).not.toHaveBeenCalled();
      }
    );

    test(
      "uses 10 questions by default",
      async () => {
        const mockSession = {
          id:
            "mock-session-1",

          mode:
            "Quiz Style",

          jobRole:
            "Software Engineer",

          experienceLevel:
            "Intermediate",

          tags: [
            "data structures",
          ],

          questionCount: 10,

          status:
            "active",
        };

        interviewService
          .startSession
          .mockResolvedValue(
            mockSession
          );

        renderPage();

        await fillValidSetup();

        userEvent.click(
          screen.getByRole(
            "button",
            {
              name:
                "Start Session",
            }
          )
        );

        await waitFor(() => {
          expect(
            interviewService
              .startSession
          ).toHaveBeenCalledWith({
            mode:
              "Quiz Style",

            jobRole:
              "Software Engineer",

            experienceLevel:
              "Intermediate",

            tags: [
              "data structures",
            ],

            questionCount: 10,
          });
        });
      }
    );

    test(
      "passes multiple selected practice goals to startSession",
      async () => {
        interviewService
          .startSession
          .mockResolvedValue({
            id:
              "mock-session-1",

            status:
              "active",
          });

        renderPage();

        await selectSoftwareEngineer();

        await selectIntermediateExperience();

        userEvent.click(
          screen.getByRole(
            "button",
            {
              name:
                "Algorithms",
            }
          )
        );

        userEvent.click(
          screen.getByRole(
            "button",
            {
              name:
                "Testing",
            }
          )
        );

        userEvent.click(
          screen.getByRole(
            "button",
            {
              name:
                "Start Session",
            }
          )
        );

        await waitFor(() => {
          expect(
            interviewService
              .startSession
          ).toHaveBeenCalledWith({
            mode:
              "Quiz Style",

            jobRole:
              "Software Engineer",

            experienceLevel:
              "Intermediate",

            tags: [
              "algorithms",
              "testing",
            ],

            questionCount: 10,
          });
        });
      }
    );

    test(
      "passes the selected question count to startSession",
      async () => {
        interviewService
          .startSession
          .mockResolvedValue({
            id:
              "mock-session-1",

            status:
              "active",
          });

        renderPage();

        await fillValidSetup();

        const questionCountInput =
          screen.getByRole(
            "spinbutton",
            {
              name:
                "Number of Questions",
            }
          );

        userEvent.clear(
          questionCountInput
        );

        userEvent.type(
          questionCountInput,
          "20"
        );

        userEvent.click(
          screen.getByRole(
            "button",
            {
              name:
                "Start Session",
            }
          )
        );

        await waitFor(() => {
          expect(
            interviewService
              .startSession
          ).toHaveBeenCalledWith({
            mode:
              "Quiz Style",

            jobRole:
              "Software Engineer",

            experienceLevel:
              "Intermediate",

            tags: [
              "data structures",
            ],

            questionCount: 20,
          });
        });
      }
    );

    test(
      "rejects a question count greater than 20",
      async () => {
        renderPage();

        await fillValidSetup();

        const questionCountInput =
          screen.getByRole(
            "spinbutton",
            {
              name:
                "Number of Questions",
            }
          );

        userEvent.clear(
          questionCountInput
        );

        userEvent.type(
          questionCountInput,
          "21"
        );

        userEvent.click(
          screen.getByRole(
            "button",
            {
              name:
                "Start Session",
            }
          )
        );

        expect(
          screen.getByText(
            "Please choose between 1 and 20 questions."
          )
        ).toBeInTheDocument();

        expect(
          interviewService
            .startSession
        ).not.toHaveBeenCalled();

        expect(
          onStartInterview
        ).not.toHaveBeenCalled();
      }
    );

    test(
      "passes the returned session to onStartInterview",
      async () => {
        const mockSession = {
          id:
            "mock-session-1",

          mode:
            "Quiz Style",

          jobRole:
            "Software Engineer",

          experienceLevel:
            "Intermediate",

          tags: [
            "data structures",
          ],

          questionCount: 10,

          status:
            "active",
        };

        interviewService
          .startSession
          .mockResolvedValue(
            mockSession
          );

        renderPage();

        await fillValidSetup();

        userEvent.click(
          screen.getByRole(
            "button",
            {
              name:
                "Start Session",
            }
          )
        );

        await waitFor(() => {
          expect(
            onStartInterview
          ).toHaveBeenCalledWith(
            mockSession
          );
        });
      }
    );

    test(
      "displays an error when setup options cannot be loaded",
      async () => {
        interviewService
          .getSetupOptions
          .mockRejectedValue(
            new Error(
              "Unable to load setup options."
            )
          );

        renderPage();

        expect(
          await screen.findByText(
            "Unable to load setup options."
          )
        ).toBeInTheDocument();

        expect(
          screen.getByLabelText(
            "Job Role"
          )
        ).toBeDisabled();

        expect(
          screen.getByRole(
            "button",
            {
              name:
                "Start Session",
            }
          )
        ).toBeDisabled();
      }
    );

    test(
      "does not load setup options when no interview mode is selected",
      async () => {
        renderPage("");

        expect(
          await screen.findByText(
            "Select an interview mode before configuring a session."
          )
        ).toBeInTheDocument();

        expect(
          interviewService
            .getSetupOptions
        ).not.toHaveBeenCalled();

        expect(
          interviewService
            .getQuestionQuota
        ).not.toHaveBeenCalled();
      }
    );

    test(
      "Cancel returns the user to the dashboard",
      async () => {
        renderPage();

        await waitForSetupOptions();

        userEvent.click(
          screen.getByRole(
            "button",
            {
              name: "Cancel",
            }
          )
        );

        expect(
          onNavigate
        ).toHaveBeenCalledWith(
          PAGES.DASHBOARD
        );
      }
    );

    /*
     * --------------------------------------------------
     * Daily quota tests
     * --------------------------------------------------
     */

    test(
      "displays the shared daily allowance for Code Style",
      async () => {
        interviewService
          .getQuestionQuota
          .mockResolvedValue({
            role: "user",

            unlimited:
              false,

            limit: 20,

            used: 7,

            remaining: 13,

            codeQuestionsUsed: 4,

            theoreticalQuestionsUsed:
              3,

            dateKey:
              "2026-10-09",

            timeZone:
              "America/Los_Angeles",
          });

        renderPage(
          "Code Style"
        );

        expect(
          await screen.findByText(
            "13 of 20 remaining today"
          )
        ).toBeInTheDocument();

        expect(
          screen.getByText(
            /code used:/i
          )
        ).toHaveTextContent(
          "Code used: 4"
        );

        expect(
          screen.getByText(
            /theoretical used:/i
          )
        ).toHaveTextContent(
          "Theoretical used: 3"
        );

        expect(
          interviewService
            .getQuestionQuota
        ).toHaveBeenCalledTimes(
          1
        );
      }
    );

    test(
      "displays the shared daily allowance for Theoretical Style",
      async () => {
        interviewService
          .getQuestionQuota
          .mockResolvedValue({
            role: "user",

            unlimited:
              false,

            limit: 20,

            used: 9,

            remaining: 11,

            codeQuestionsUsed: 5,

            theoreticalQuestionsUsed:
              4,

            dateKey:
              "2026-10-09",

            timeZone:
              "America/Los_Angeles",
          });

        renderPage(
          "Theoretical Style"
        );

        expect(
          await screen.findByText(
            "11 of 20 remaining today"
          )
        ).toBeInTheDocument();

        expect(
          screen.getByText(
            /code used:/i
          )
        ).toHaveTextContent(
          "Code used: 5"
        );

        expect(
          screen.getByText(
            /theoretical used:/i
          )
        ).toHaveTextContent(
          "Theoretical used: 4"
        );
      }
    );

    test(
      "limits Code Style question count to remaining daily allowance",
      async () => {
        interviewService
          .getQuestionQuota
          .mockResolvedValue({
            role: "user",

            unlimited:
              false,

            limit: 20,

            used: 16,

            remaining: 4,

            codeQuestionsUsed: 10,

            theoreticalQuestionsUsed:
              6,

            dateKey:
              "2026-10-09",

            timeZone:
              "America/Los_Angeles",
          });

        renderPage(
          "Code Style"
        );

        await waitForQuota();

        await waitFor(() => {
          expect(
            screen.getByRole(
              "spinbutton",
              {
                name:
                  "Number of Questions",
              }
            )
          ).toHaveValue(4);
        });

        expect(
          screen.getByText(
            "1–4 available today"
          )
        ).toBeInTheDocument();

        expect(
          screen.getByRole(
            "button",
            {
              name:
                "Increase question count",
            }
          )
        ).toBeDisabled();
      }
    );

    test(
      "allows the user to decrease a quota-limited question count",
      async () => {
        interviewService
          .getQuestionQuota
          .mockResolvedValue({
            ...defaultQuota,

            used: 16,

            remaining: 4,
          });

        renderPage(
          "Code Style"
        );

        await waitForQuota();

        const input =
          screen.getByRole(
            "spinbutton",
            {
              name:
                "Number of Questions",
            }
          );

        await waitFor(() => {
          expect(
            input
          ).toHaveValue(4);
        });

        userEvent.click(
          screen.getByRole(
            "button",
            {
              name:
                "Decrease question count",
            }
          )
        );

        expect(
          input
        ).toHaveValue(3);
      }
    );

    test(
      "disables counted sessions when daily allowance is exhausted",
      async () => {
        interviewService
          .getQuestionQuota
          .mockResolvedValue({
            role: "user",

            unlimited:
              false,

            limit: 20,

            used: 20,

            remaining: 0,

            codeQuestionsUsed: 12,

            theoreticalQuestionsUsed:
              8,

            dateKey:
              "2026-10-09",

            timeZone:
              "America/Los_Angeles",
          });

        renderPage(
          "Code Style"
        );

        expect(
          await screen.findByText(
            /daily limit reached/i
          )
        ).toBeInTheDocument();

        expect(
          screen.getByRole(
            "button",
            {
              name:
                "Start Session",
            }
          )
        ).toBeDisabled();

        expect(
          screen.getByRole(
            "spinbutton",
            {
              name:
                "Number of Questions",
            }
          )
        ).toHaveValue(0);

        expect(
          screen.getByText(
            "No questions remaining today"
          )
        ).toBeInTheDocument();
      }
    );

    test(
      "Quiz Style does not request or display daily quota",
      async () => {
        renderPage(
          "Quiz Style"
        );

        await waitForSetupOptions();

        expect(
          interviewService
            .getQuestionQuota
        ).not.toHaveBeenCalled();

        expect(
          screen.queryByText(
            "Daily Question Allowance"
          )
        ).not.toBeInTheDocument();

        expect(
          screen.getByText(
            "1–20 questions"
          )
        ).toBeInTheDocument();
      }
    );

    test(
      "admin sees an unlimited daily allowance",
      async () => {
        interviewService
          .getQuestionQuota
          .mockResolvedValue({
            role: "admin",

            unlimited: true,

            limit: null,

            used: 0,

            remaining: null,

            codeQuestionsUsed: 0,

            theoreticalQuestionsUsed:
              0,

            dateKey:
              "2026-10-09",

            timeZone:
              "America/Los_Angeles",
          });

        renderPage(
          "Theoretical Style"
        );

        expect(
          await screen.findByText(
            "Unlimited questions"
          )
        ).toBeInTheDocument();

        await waitForSetupOptions();

        expect(
          screen.getByText(
            "1–20 questions"
          )
        ).toBeInTheDocument();

        expect(
          screen.getByRole(
            "button",
            {
              name:
                "Start Session",
            }
          )
        ).toBeEnabled();
      }
    );

    test(
      "quota loading failure disables counted session start",
      async () => {
        interviewService
          .getQuestionQuota
          .mockRejectedValue(
            new Error(
              "Unable to load daily allowance."
            )
          );

        renderPage(
          "Code Style"
        );

        expect(
          await screen.findByText(
            "Unable to load daily allowance."
          )
        ).toBeInTheDocument();

        await waitForSetupOptions();

        expect(
          screen.getByRole(
            "button",
            {
              name:
                "Start Session",
            }
          )
        ).toBeDisabled();
      }
    );

    test(
      "refreshes quota before starting a Code session",
      async () => {
        /*
         * First quota request:
         * user has 20 available.
         *
         * Second quota request:
         * immediately before starting,
         * user now has only 5.
         */
        interviewService
          .getQuestionQuota
          .mockResolvedValueOnce({
            ...defaultQuota,

            remaining: 20,
            used: 0,
          })
          .mockResolvedValueOnce({
            ...defaultQuota,

            remaining: 5,
            used: 15,
          });

        renderPage(
          "Code Style"
        );

        await fillValidSetup();

        await waitForQuota();

        userEvent.click(
          screen.getByRole(
            "button",
            {
              name:
                "Start Session",
            }
          )
        );

        expect(
          await screen.findByText(
            /your remaining allowance changed/i
          )
        ).toBeInTheDocument();

        expect(
          screen.getByText(
            /you now have 5 questions available today/i
          )
        ).toBeInTheDocument();

        expect(
          interviewService
            .startSession
        ).not.toHaveBeenCalled();

        expect(
          screen.getByRole(
            "spinbutton",
            {
              name:
                "Number of Questions",
            }
          )
        ).toHaveValue(5);
      }
    );

    test(
      "starts Code session when refreshed quota still allows requested count",
      async () => {
        interviewService
          .getQuestionQuota
          .mockResolvedValue({
            ...defaultQuota,

            remaining: 20,
          });

        const mockSession = {
          id:
            "code-session-1",

          mode:
            "Code Style",

          status:
            "active",
        };

        interviewService
          .startSession
          .mockResolvedValue(
            mockSession
          );

        renderPage(
          "Code Style"
        );

        await fillValidSetup();

        await waitForQuota();

        userEvent.click(
          screen.getByRole(
            "button",
            {
              name:
                "Start Session",
            }
          )
        );

        await waitFor(() => {
          expect(
            interviewService
              .startSession
          ).toHaveBeenCalledWith({
            mode:
              "Code Style",

            jobRole:
              "Software Engineer",

            experienceLevel:
              "Intermediate",

            tags: [
              "data structures",
            ],

            questionCount: 10,
          });
        });

        expect(
          interviewService
            .getQuestionQuota
        ).toHaveBeenCalledTimes(
          2
        );

        await waitFor(() => {
          expect(
            onStartInterview
          ).toHaveBeenCalledWith(
            mockSession
          );
        });
      }
    );

    test(
      "shows shared allowance in the session summary",
      async () => {
        interviewService
          .getQuestionQuota
          .mockResolvedValue({
            ...defaultQuota,

            used: 8,

            remaining: 12,

            codeQuestionsUsed: 3,

            theoreticalQuestionsUsed:
              5,
          });

        renderPage(
          "Code Style"
        );

        expect(
          await screen.findByText(
            "12/20 left"
          )
        ).toBeInTheDocument();
      }
    );
  }
);