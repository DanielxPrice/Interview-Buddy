import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import SessionResultsPage from "./SessionResultsPage";
import { historyService } from "../services/historyService";

jest.mock("../components/layout/PageLayout", () => ({ children, title }) => <main><h1>{title}</h1>{children}</main>);
jest.mock("../services/historyService", () => ({ historyService: { getSessionById: jest.fn() } }));

function renderResult(path, sessionResult = null) {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/results/:sessionId" element={<SessionResultsPage currentPage={path} onNavigate={jest.fn()} sessionResult={sessionResult} />} /></Routes></MemoryRouter>);
}

test("shows detailed data from a newly completed interview without another request", () => {
  renderResult("/results/s1", { sessionId: "s1", mode: "Code Style", score: "92%", date: "October 20, 2026", questionsAnswered: 1, perQuestion: [{ questionId: "q1", prompt: "Explain a binary tree", userAnswer: "It has nodes", score: 92, feedback: "Good", strengths: ["Clear"] }] });
  expect(screen.getByText("Explain a binary tree")).toBeInTheDocument();
  expect(screen.getByText("It has nodes")).toBeInTheDocument();
  expect(screen.getByText("Good")).toBeInTheDocument();
  expect(historyService.getSessionById).not.toHaveBeenCalled();
});

test("loads saved summary on a directly opened result URL", async () => {
  historyService.getSessionById.mockResolvedValue({ id: "s2", mode: "Quiz Style", status: "completed", result: { score: 72, questionsAnswered: 4 }, completedAt: "2026-10-21T12:00:00Z" });
  renderResult("/results/s2");
  expect(await screen.findByText("72%")).toBeInTheDocument();
  expect(screen.getByText("This session's score is saved")).toBeInTheDocument();
  expect(historyService.getSessionById).toHaveBeenCalledWith("s2");
});

test("shows missing state when session does not exist", async () => {
  historyService.getSessionById.mockResolvedValue(null);
  renderResult("/results/missing");
  expect(await screen.findByText("Results unavailable")).toBeInTheDocument();
});
