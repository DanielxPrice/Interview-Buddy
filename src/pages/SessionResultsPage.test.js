
import React from "react";

import {
  render,
  screen,
} from "@testing-library/react";

import {
  MemoryRouter,
  Route,
  Routes,
} from "react-router-dom";

import SessionResultsPage from "./SessionResultsPage";

import {
  historyService,
} from "../services/historyService";

jest.mock(
  "../components/layout/PageLayout",
  () =>
    ({ children, title }) =>
      (
        <main>
          <h1>{title}</h1>
          {children}
        </main>
      )
);

jest.mock("../services/historyService", () => ({
  historyService: {
    getCompletedSessionResults: jest.fn(),
  },
}));

function renderResult(
  path,
  sessionResult = null
) {
  return render(
    <MemoryRouter
      initialEntries={[path]}
    >
      <Routes>
        <Route
          path="/results/:sessionId"
          element={
            <SessionResultsPage
              currentPage={path}
              onNavigate={jest.fn()}
              sessionResult={sessionResult}
            />
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

test("freshly completed interviews show in-memory details without a reload request", () => {
  renderResult(
    "/results/s1",
    {
      sessionId: "s1",
      mode: "Code Style",
      score: "92%",
      date: "October 20, 2026",
      questionsAnswered: 1,

      perQuestion: [
        {
          questionId: "q1",
          prompt: "Explain a binary tree",
          userAnswer: "It has nodes",
          score: 92,
          feedback: "Good",
          strengths: ["Clear"],
        },
      ],
    }
  );

  expect(
    screen.getByText("Explain a binary tree")
  ).toBeInTheDocument();

  expect(
    screen.getByText("It has nodes")
  ).toBeInTheDocument();

  expect(
    screen.getByText("Good")
  ).toBeInTheDocument();

  expect(
    historyService.getCompletedSessionResults
  ).not.toHaveBeenCalled();
});

test("directly opened legacy session shows saved summary", async () => {
  historyService.getCompletedSessionResults
    .mockResolvedValue({
      id: "s2",
      mode: "Quiz Style",
      status: "completed",

      result: {
        score: 72,
        questionsAnswered: 4,
      },

      completedAt:
        "2026-10-21T12:00:00Z",
    });

  renderResult("/results/s2");

  expect(
    await screen.findByText("72%")
  ).toBeInTheDocument();

  expect(
    screen.getByText(
      "This session's score is saved"
    )
  ).toBeInTheDocument();

  expect(
    historyService.getCompletedSessionResults
  ).toHaveBeenCalledWith("s2");
});

test("reloaded SEC-03 interview preserves feedback, rubric, and eligible ELO", async () => {
  historyService.getCompletedSessionResults
    .mockResolvedValue({
      id: "s3",
      mode: "Theoretical Style",
      status: "completed",

      result: {
        score: 90,
        questionsAnswered: 1,
        questionsAssigned: 1,
        questionsUnanswered: 0,
        completionStatus: "completed",
        rankEligible: true,
      },

      eloChange: "+2",

      completedAt:
        "2026-10-27T20:00:00Z",

      breakdownAvailable: true,

      breakdown: [
        {
          questionId: "theory-1",
          questionPrompt: "Explain BFS",
          userAnswer: "It uses a queue",
          score: 90,
          feedback: "Correct explanation",

          strengths: ["Clear"],

          weaknesses: [
            "Complexity missing",
          ],

          suggestions: [
            "Mention O(V + E)",
          ],

          criterionResults: [
            {
              name: "Correctness",
              awardedPoints: 45,
              maxPoints: 50,
              feedback: "Good",
            },
          ],
        },
      ],
    });

  renderResult("/results/s3");

  expect(
    await screen.findByText("Explain BFS")
  ).toBeInTheDocument();

  expect(
    screen.getByText("It uses a queue")
  ).toBeInTheDocument();

  expect(
    screen.getByText("Correct explanation")
  ).toBeInTheDocument();

  expect(
    screen.getByText("Clear")
  ).toBeInTheDocument();

  expect(
    screen.getByText("Complexity missing")
  ).toBeInTheDocument();

  expect(
    screen.getByText("Mention O(V + E)")
  ).toBeInTheDocument();

  expect(
    screen.getByText("+2")
  ).toBeInTheDocument();
});

test("missing completed session shows the unavailable state", async () => {
  historyService.getCompletedSessionResults
    .mockResolvedValue(null);

  renderResult("/results/missing");

  expect(
    await screen.findByText(
      "Results unavailable"
    )
  ).toBeInTheDocument();
});
