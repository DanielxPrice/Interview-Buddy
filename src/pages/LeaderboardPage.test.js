import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import LeaderboardPage from "./LeaderboardPage";
import { useAuth } from "../context/AuthContext";
import { leaderboardService } from "../services/leaderboardService";

jest.mock("../components/layout/PageLayout", () => ({ title, children }) => (
  <main><h1>{title}</h1>{children}</main>
));
jest.mock("../context/AuthContext", () => ({ useAuth: jest.fn() }));
jest.mock("../services/leaderboardService", () => ({
  leaderboardService: {
    getGlobalLeaderboard: jest.fn(),
    getFriendsLeaderboard: jest.fn(),
    getUserRanking: jest.fn(),
    sendFriendRequest: jest.fn(),
    removeFriend: jest.fn(),
  },
}));

const unavailable = () => Object.assign(new Error("Ranking and friends data is not available yet."), { code: "feature-unavailable" });

beforeEach(() => {
  jest.clearAllMocks();
  useAuth.mockReturnValue({ user: { uid: "test-user" } });
  leaderboardService.getGlobalLeaderboard.mockRejectedValue(unavailable());
  leaderboardService.getFriendsLeaderboard.mockRejectedValue(unavailable());
  leaderboardService.getUserRanking.mockRejectedValue(unavailable());
});

test("unimplemented backend shows unavailable states rather than mock rankings", async () => {
  render(<LeaderboardPage currentPage="/leaderboard" onNavigate={() => {}} />);
  expect(await screen.findByText("Ranking data is not available yet")).toBeInTheDocument();
  expect(screen.getByText("Your ranking is not available yet.")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Rank badge unavailable" })).toBeInTheDocument();
  expect(screen.queryByAltText(/ELO rank badge/)).not.toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.getByText("Friends data is not available yet.")).toBeInTheDocument();
  expect(screen.getByText("No sample rankings are displayed.", { exact: false })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("tab", { name: "Friends" }));
  expect(screen.getByRole("tab", { name: "Friends" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("button", { name: "Add Friend" })).toBeDisabled();
  expect(screen.getByRole("textbox", { name: "Username" })).toBeDisabled();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(leaderboardService.sendFriendRequest).not.toHaveBeenCalled();
});

test("successful empty backend responses show No available data and zero friends", async () => {
  leaderboardService.getGlobalLeaderboard.mockResolvedValue([]);
  leaderboardService.getFriendsLeaderboard.mockResolvedValue([]);
  leaderboardService.getUserRanking.mockResolvedValue(null);

  render(<LeaderboardPage currentPage="/leaderboard" onNavigate={() => {}} />);
  expect(await screen.findByText("No available data", { selector: "h2" })).toBeInTheDocument();
  expect(screen.getByText("You do not have a ranking yet.")).toBeInTheDocument();
  expect(screen.getByText("No friends available yet.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "Friends" }));
  expect(screen.getByRole("button", { name: "Add Friend" })).toBeDisabled(); // Requires a username.
  expect(screen.getByRole("textbox", { name: "Username" })).toBeEnabled();
  expect(screen.getByText("There are no rankings to display yet.")).toBeInTheDocument();
});

test("renders real API results and the authenticated account's personal ranking", async () => {
  leaderboardService.getGlobalLeaderboard.mockResolvedValue([
    { uid: "someone", username: "Sam", elo: 1500, rank: 1 },
    { uid: "test-user", username: "Me", elo: 1250, rank: 2 },
  ]);
  leaderboardService.getFriendsLeaderboard.mockResolvedValue([
    { uid: "friend-1", username: "Taylor", elo: 1400, rank: 5 },
  ]);
  leaderboardService.getUserRanking.mockResolvedValue({ uid: "test-user", username: "Me", rank: 2, elo: 1250 });

  render(<LeaderboardPage currentPage="/leaderboard" onNavigate={() => {}} />);
  const table = await screen.findByRole("table");
  expect(within(table).getByText("Sam")).toBeInTheDocument();
  expect(within(table).getByText("Me")).toBeInTheDocument();
  expect(within(table).getByText("You")).toBeInTheDocument();
  expect(screen.getByText("#2")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Graduate ELO rank badge" })).toHaveAttribute(
    "src", "/Cheerful%20Graduate%20Mascot%20Badge.png"
  );
  expect(screen.getAllByText("1,250").length).toBeGreaterThan(0);
  expect(screen.getByText("Taylor")).toBeInTheDocument();
  expect(screen.getByText("Rank #5")).toBeInTheDocument();
});

test("friend request and removal call APIs, not local fake changes", async () => {
  const friend = { uid: "friend-1", username: "Taylor", elo: 1400, rank: 5 };
  leaderboardService.getGlobalLeaderboard.mockResolvedValue([]);
  leaderboardService.getFriendsLeaderboard
    .mockResolvedValueOnce([friend]) // Load on mount.
    .mockResolvedValueOnce([friend]) // Pending request does not add a friend.
    .mockResolvedValueOnce([]); // Removal persists in backend.
  leaderboardService.getUserRanking.mockResolvedValue(null);
  leaderboardService.sendFriendRequest.mockResolvedValue({ status: "pending" });
  leaderboardService.removeFriend.mockResolvedValue({});

  render(<LeaderboardPage currentPage="/leaderboard" onNavigate={() => {}} />);
  fireEvent.click(screen.getByRole("tab", { name: "Friends" }));
  expect(await screen.findByRole("button", { name: "Remove Taylor from friends" })).toBeInTheDocument();

  fireEvent.change(screen.getByRole("textbox", { name: "Username" }), { target: { value: "Morgan" } });
  fireEvent.click(screen.getByRole("button", { name: "Add Friend" }));
  await waitFor(() => expect(leaderboardService.sendFriendRequest).toHaveBeenCalledWith("Morgan"));
  expect(await screen.findByText(/Friend request sent to "Morgan"/)).toBeInTheDocument();
  expect(screen.queryByText("Morgan", { selector: ".ibRankingUsername" })).not.toBeInTheDocument();

  await waitFor(() => expect(screen.getByRole("button", { name: "Remove Taylor from friends" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Remove Taylor from friends" }));
  await waitFor(() => expect(leaderboardService.removeFriend).toHaveBeenCalledWith("friend-1"));
  expect(await screen.findByText("No available data", { selector: "h2" })).toBeInTheDocument();
});

test("failed requests do not claim a friend was added", async () => {
  leaderboardService.getGlobalLeaderboard.mockResolvedValue([]);
  leaderboardService.getFriendsLeaderboard.mockResolvedValue([]);
  leaderboardService.getUserRanking.mockResolvedValue(null);
  leaderboardService.sendFriendRequest.mockRejectedValue(unavailable());

  render(<LeaderboardPage currentPage="/leaderboard" onNavigate={() => {}} />);
  fireEvent.click(screen.getByRole("tab", { name: "Friends" }));
  const input = await screen.findByRole("textbox", { name: "Username" });
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, { target: { value: "Alex" } });
  fireEvent.click(screen.getByRole("button", { name: "Add Friend" }));
  expect(await screen.findByText("Ranking and friends data is not available yet.")).toBeInTheDocument();
  expect(screen.queryByText(/Friend request sent/)).not.toBeInTheDocument();
});
