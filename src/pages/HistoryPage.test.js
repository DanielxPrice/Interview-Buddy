import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import HistoryPage from "./HistoryPage";
import { historyService } from "../services/historyService";

jest.mock("../components/layout/PageLayout", () => ({ children, title }) => <main><h1>{title}</h1>{children}</main>);
jest.mock("../services/historyService", () => ({ historyService: { getSessionPage: jest.fn() } }));

const sessions = [
  { id: "s1", status: "completed", mode: "Code Style", jobRole: "Backend Developer", completedAt: "2026-10-20T12:00:00Z", result: { score: 91, questionsAnswered: 4 } },
  { id: "s2", status: "completed", mode: "Quiz Style", jobRole: "Frontend Engineer", completedAt: "2026-10-21T12:00:00Z", result: { score: 43, questionsAnswered: 6 } },
];

beforeEach(() => {
  jest.clearAllMocks();
  historyService.getSessionPage.mockResolvedValue({ sessions, nextCursor: null });
});

test("loads completed sessions and opens a result by session ID", async () => {
  const onNavigate = jest.fn();
  render(<HistoryPage currentPage="/history" onNavigate={onNavigate} onSelectMode={jest.fn()} />);
  expect(await screen.findByText("Backend Developer Interview")).toBeInTheDocument();
  expect(screen.getByText("Frontend Engineer Interview")).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("button", { name: "View Results" })[0]);
  expect(onNavigate).toHaveBeenCalledWith("/results/s2");
});

test("filters by mode and clears filters", async () => {
  render(<HistoryPage currentPage="/history" onNavigate={jest.fn()} />);
  await screen.findByText("Backend Developer Interview");
  fireEvent.change(screen.getByLabelText("Filter interview mode"), { target: { value: "Code Style" } });
  expect(screen.getByText("Backend Developer Interview")).toBeInTheDocument();
  expect(screen.queryByText("Frontend Engineer Interview")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(screen.getByText("Frontend Engineer Interview")).toBeInTheDocument();
});

test("shows empty and failed-request states without placeholder sessions", async () => {
  historyService.getSessionPage.mockResolvedValueOnce({ sessions: [], nextCursor: null });
  const { unmount } = render(<HistoryPage currentPage="/history" onNavigate={jest.fn()} />);
  expect(await screen.findByText("No completed interviews yet")).toBeInTheDocument();
  unmount();
  historyService.getSessionPage.mockRejectedValueOnce(new Error("Offline"));
  render(<HistoryPage currentPage="/history" onNavigate={jest.fn()} />);
  expect(await screen.findByText("Offline")).toBeInTheDocument();
});


test("loads older interviews only after the user requests another page", async () => {
  historyService.getSessionPage
    .mockResolvedValueOnce({ sessions, nextCursor: "s1" })
    .mockResolvedValueOnce({ sessions: [{
      id: "s0", status: "completed", mode: "Quiz Style", jobRole: "Older Engineer",
      completedAt: "2026-10-01T12:00:00Z", result: { score: 70 },
    }], nextCursor: null });
  render(<HistoryPage currentPage="/history" onNavigate={jest.fn()} />);
  expect(await screen.findByText("Backend Developer Interview")).toBeInTheDocument();
  expect(screen.queryByText("Older Engineer Interview")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Load Older Sessions/i }));
  expect(await screen.findByText("Older Engineer Interview")).toBeInTheDocument();
  expect(historyService.getSessionPage).toHaveBeenLastCalledWith({ cursor: "s1", pageSize: 25 });
});
