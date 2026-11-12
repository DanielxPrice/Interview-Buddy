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
    getFriendRequests: jest.fn(),
    getFriendsLeaderboard: jest.fn(),
    getUserRanking: jest.fn(),
    getAcceptedFriends: jest.fn(),
    sendFriendRequest: jest.fn(),
    acceptFriendRequest: jest.fn(),
    declineFriendRequest: jest.fn(),
    removeFriend: jest.fn(),
  },
}));

const unavailable = () => Object.assign(new Error("Ranking and friends data is not available yet."), { code: "feature-unavailable" });

beforeEach(() => {
  jest.clearAllMocks();
  useAuth.mockReturnValue({ user: { uid: "test-user" } });
  leaderboardService.getGlobalLeaderboard.mockRejectedValue(unavailable());
  leaderboardService.getFriendRequests.mockResolvedValue({
    incoming: [],
    outgoing: [],
  });
  leaderboardService.getFriendsLeaderboard.mockRejectedValue(unavailable());
  leaderboardService.getUserRanking.mockRejectedValue(unavailable());
  leaderboardService.getAcceptedFriends.mockResolvedValue([]);
});

test("unimplemented backend shows unavailable states rather than mock rankings", async () => {
  leaderboardService.getAcceptedFriends.mockRejectedValue(unavailable());
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

test("renders real points and global standing without claiming ELO exists", async () => {
  leaderboardService.getGlobalLeaderboard.mockResolvedValue([
    { uid: "someone", username: "Sam", points: 180, rankedSessions: 2, averageScore: 90, elo: null, rank: 1 },
    { uid: "test-user", username: "Me", points: 160, rankedSessions: 2, averageScore: 80, elo: null, rank: 2 },
  ]);
  leaderboardService.getFriendsLeaderboard.mockRejectedValue(unavailable());
  leaderboardService.getUserRanking.mockResolvedValue({
    uid: "test-user", username: "Me", rank: 2,
    points: 160, rankedSessions: 2, averageScore: 80, elo: null,
  });

  render(<LeaderboardPage currentPage="/leaderboard" onNavigate={() => {}} />);
  const table = await screen.findByRole("table");
  expect(within(table).getByRole("columnheader", { name: "Points" })).toBeInTheDocument();
  expect(within(table).getByText("Sam")).toBeInTheDocument();
  expect(within(table).getByText("Me")).toBeInTheDocument();
  expect(within(table).getByText("You")).toBeInTheDocument();
  expect(within(table).getByText("180")).toBeInTheDocument();
  expect(screen.getByText("#2")).toBeInTheDocument();
  expect(screen.getByText("Total Points")).toBeInTheDocument();
  expect(screen.getAllByText("160").length).toBeGreaterThan(0);
  expect(screen.getByRole("img", { name: "Rank badge unavailable" })).toBeInTheDocument();
  expect(screen.queryByAltText(/ELO rank badge/)).not.toBeInTheDocument();
  expect(screen.getByText("No friends available yet.")).toBeInTheDocument();
});

test("friends tab retains ELO labels for the future friends service", async () => {
  leaderboardService.getGlobalLeaderboard.mockResolvedValue([]);
  leaderboardService.getFriendsLeaderboard.mockResolvedValue([
    { uid: "friend-1", username: "Taylor", elo: 1400, rank: 5 },
  ]);
  leaderboardService.getUserRanking.mockResolvedValue(null);
  leaderboardService.getAcceptedFriends.mockResolvedValue([
    { uid: "friend-1", username: "Taylor" },
  ]);
  render(<LeaderboardPage currentPage="/leaderboard" onNavigate={() => {}} />);
  fireEvent.click(screen.getByRole("tab", { name: "Friends" }));
  const table = await screen.findByRole("table");
  expect(within(table).getByRole("columnheader", { name: "ELO Score" })).toBeInTheDocument();
  expect(within(table).getByText("1,400")).toBeInTheDocument();
  expect(within(table).getByText("Taylor")).toBeInTheDocument();
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

//Test verifies taht the frontend correctly separates incoming and outgoing requests
test("displays real incoming and outgoing pending friend requests", async () => {
  leaderboardService.getGlobalLeaderboard.mockResolvedValue([]);
  leaderboardService.getFriendsLeaderboard.mockResolvedValue([]);
  leaderboardService.getUserRanking.mockResolvedValue(null);

  leaderboardService.getFriendRequests.mockResolvedValue({
    incoming: [
      {
        id: "request-1",
        requesterUid: "alice",
        recipientUid: "test-user",
        status: "pending",
        user: {
          uid: "alice",
          username: "Alice",
        },
      },
    ],
    outgoing: [
      {
        id: "request-2",
        requesterUid: "test-user",
        recipientUid: "bob",
        status: "pending",
        user: {
          uid: "bob",
          username: "Bob",
        },
      },
    ],
  });

  render(
    <LeaderboardPage
      currentPage="/leaderboard"
      onNavigate={() => {}}
    />
  );

  fireEvent.click(
    screen.getByRole("tab", { name: "Friends" })
  );

  const incoming = await screen.findByRole("region", {
    name: "Incoming Friend Requests",
  });

  const outgoing = screen.getByRole("region", {
    name: "Sent Friend Requests",
  });

  expect(
    await within(incoming).findByText("Alice")
  ).toBeInTheDocument();

  expect(
    within(outgoing).getByText("Bob")
  ).toBeInTheDocument();

  expect(
    within(incoming).getByText("Pending")
  ).toBeInTheDocument();

  expect(
    within(outgoing).getByText("Pending")
  ).toBeInTheDocument();
});

//Confirms that sending a request updates the pending request display without relying on fake frontend state
test("successful friend request refreshes sent requests from the server", async () => {
  leaderboardService.getGlobalLeaderboard.mockResolvedValue([]);
  leaderboardService.getFriendsLeaderboard.mockResolvedValue([]);
  leaderboardService.getUserRanking.mockResolvedValue(null);

  leaderboardService.getFriendRequests
    .mockResolvedValueOnce({
      incoming: [],
      outgoing: [],
    })
    .mockResolvedValueOnce({
      incoming: [],
      outgoing: [
        {
          id: "request-3",
          requesterUid: "test-user",
          recipientUid: "morgan",
          status: "pending",
          user: {
            uid: "morgan",
            username: "Morgan",
          },
        },
      ],
    });

  leaderboardService.sendFriendRequest.mockResolvedValue({
    request: { status: "pending" },
  });

  render(
    <LeaderboardPage
      currentPage="/leaderboard"
      onNavigate={() => {}}
    />
  );

  fireEvent.click(
    screen.getByRole("tab", { name: "Friends" })
  );

  const input = await screen.findByRole("textbox", {
    name: "Username",
  });

  await waitFor(() => expect(input).toBeEnabled());

  fireEvent.change(input, {
    target: { value: "Morgan" },
  });

  fireEvent.click(
    screen.getByRole("button", { name: "Add Friend" })
  );

  const outgoing = screen.getByRole("region", {
    name: "Sent Friend Requests",
  });

  expect(
    await within(outgoing).findByText("Morgan")
  ).toBeInTheDocument();

  expect(
    leaderboardService.getFriendRequests
  ).toHaveBeenCalledTimes(2);
});

//Accepting a friend request
test("accepting a request updates the pending list and friends rankings", async () => {
  const requestRecord = {
    id: "request-1",
    requesterUid: "alice",
    recipientUid: "test-user",
    status: "pending",
    user: { uid: "alice", username: "Alice" },
  };

  leaderboardService.getGlobalLeaderboard.mockResolvedValue([]);
  leaderboardService.getUserRanking.mockResolvedValue(null);

  leaderboardService.getFriendsLeaderboard
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      { uid: "alice", username: "Alice", rank: 1, elo: 1200 },
    ]);

  leaderboardService.getFriendRequests
    .mockResolvedValueOnce({
      incoming: [requestRecord],
      outgoing: [],
    })
    .mockResolvedValueOnce({
      incoming: [],
      outgoing: [],
    });

  leaderboardService.acceptFriendRequest.mockResolvedValue({
    request: { status: "accepted" },
  });

  render(
    <LeaderboardPage
      currentPage="/leaderboard"
      onNavigate={() => {}}
    />
  );

  fireEvent.click(
    screen.getByRole("tab", { name: "Friends" })
  );

  const incoming = await screen.findByRole("region", {
    name: "Incoming Friend Requests",
  });

  expect(
    await within(incoming).findByText("Alice")
  ).toBeInTheDocument();

  fireEvent.click(
    within(incoming).getByRole("button", {
      name: "Accept friend request from Alice",
    })
  );

  await waitFor(() => {
    expect(
      leaderboardService.acceptFriendRequest
    ).toHaveBeenCalledWith("alice");

    expect(
      within(incoming).queryByText("Alice")
    ).not.toBeInTheDocument();
  });

  expect(
    await screen.findByText("Alice", {
      selector: ".ibRankingUsername",
    })
  ).toBeInTheDocument();
});

//Declining a friend request
test("declining a request removes it from pending requests", async () => {
  leaderboardService.getGlobalLeaderboard.mockResolvedValue([]);
  leaderboardService.getFriendsLeaderboard.mockResolvedValue([]);
  leaderboardService.getUserRanking.mockResolvedValue(null);

  leaderboardService.getFriendRequests
    .mockResolvedValueOnce({
      incoming: [
        {
          id: "request-2",
          requesterUid: "bob",
          recipientUid: "test-user",
          status: "pending",
          user: { uid: "bob", username: "Bob" },
        },
      ],
      outgoing: [],
    })
    .mockResolvedValueOnce({
      incoming: [],
      outgoing: [],
    });

  leaderboardService.declineFriendRequest.mockResolvedValue({
    request: { status: "declined" },
  });

  render(
    <LeaderboardPage
      currentPage="/leaderboard"
      onNavigate={() => {}}
    />
  );

  fireEvent.click(
    screen.getByRole("tab", { name: "Friends" })
  );

  const incoming = await screen.findByRole("region", {
    name: "Incoming Friend Requests",
  });

  expect(
    await within(incoming).findByText("Bob")
  ).toBeInTheDocument();

  fireEvent.click(
    within(incoming).getByRole("button", {
      name: "Decline friend request from Bob",
    })
  );

  await waitFor(() => {
    expect(
      leaderboardService.declineFriendRequest
    ).toHaveBeenCalledWith("bob");

    expect(
      within(incoming).queryByText("Bob")
    ).not.toBeInTheDocument();
  });

  expect(
    leaderboardService.getFriendsLeaderboard
  ).toHaveBeenCalledTimes(2);
});

//Confirms that an accepted friend remains visible independently of rankings
test("displays accepted friends even without ranking data", async () => {
  leaderboardService.getGlobalLeaderboard.mockResolvedValue([]);
  leaderboardService.getFriendsLeaderboard.mockResolvedValue([]);
  leaderboardService.getUserRanking.mockResolvedValue(null);

  leaderboardService.getAcceptedFriends.mockResolvedValue([
    { uid: "friend-1", username: "Taylor" },
  ]);

  render(
    <LeaderboardPage
      currentPage="/leaderboard"
      onNavigate={() => {}}
    />
  );

  fireEvent.click(
    screen.getByRole("tab", { name: "Friends" })
  );

  const accepted = await screen.findByRole("region", {
    name: "Accepted Friends",
  });

  expect(
    await within(accepted).findByText("Taylor")
  ).toBeInTheDocument();

  expect(
    within(accepted).getByRole("button", {
      name: "Remove Taylor from accepted friends",
    })
  ).toBeInTheDocument();

  expect(
    screen.getByText("1 friend in your list")
  ).toBeInTheDocument();

  const rankings = screen.getByRole("region", {
    name: "Friends leaderboard",
  });

  expect(
    within(rankings).getByText("0 ranked friends")
  ).toBeInTheDocument();

  expect(
    within(rankings).getByText("No available data")
  ).toBeInTheDocument();
});

//Confirm that removing will refresh and remove visibility as well
test("removing an accepted friend refreshes the friends list", async () => {
  leaderboardService.getGlobalLeaderboard.mockResolvedValue([]);
  leaderboardService.getFriendsLeaderboard.mockResolvedValue([]);
  leaderboardService.getUserRanking.mockResolvedValue(null);

  leaderboardService.getAcceptedFriends
    .mockResolvedValueOnce([
      { uid: "friend-1", username: "Taylor" },
    ])
    .mockResolvedValueOnce([]);

  leaderboardService.removeFriend.mockResolvedValue({
    removed: true,
  });

  render(
    <LeaderboardPage
      currentPage="/leaderboard"
      onNavigate={() => {}}
    />
  );

  fireEvent.click(
    screen.getByRole("tab", { name: "Friends" })
  );

  const accepted = await screen.findByRole("region", {
    name: "Accepted Friends",
  });

  const removeButton = await within(accepted).findByRole(
    "button",
    { name: "Remove Taylor from accepted friends" }
  );

  fireEvent.click(removeButton);

  await waitFor(() => {
    expect(
      leaderboardService.removeFriend
    ).toHaveBeenCalledWith("friend-1");

    expect(
      leaderboardService.getAcceptedFriends
    ).toHaveBeenCalledTimes(2);
  });

  expect(
    await within(accepted).findByText("No accepted friends")
  ).toBeInTheDocument();

  expect(
    within(accepted).queryByText("Taylor")
  ).not.toBeInTheDocument();
});

//Confirm that accepting a request refreshes the list
test("accepting a request refreshes the accepted friends list", async () => {
  const incomingRequest = {
    id: "request-alice",
    requesterUid: "alice",
    recipientUid: "test-user",
    status: "pending",
    user: { uid: "alice", username: "Alice" },
  };

  leaderboardService.getGlobalLeaderboard.mockResolvedValue([]);
  leaderboardService.getFriendsLeaderboard.mockResolvedValue([]);
  leaderboardService.getUserRanking.mockResolvedValue(null);

  leaderboardService.getFriendRequests
    .mockResolvedValueOnce({
      incoming: [incomingRequest],
      outgoing: [],
    })
    .mockResolvedValueOnce({
      incoming: [],
      outgoing: [],
    });

  leaderboardService.getAcceptedFriends
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      { uid: "alice", username: "Alice" },
    ]);

  leaderboardService.acceptFriendRequest.mockResolvedValue({
    request: { status: "accepted" },
  });

  render(
    <LeaderboardPage
      currentPage="/leaderboard"
      onNavigate={() => {}}
    />
  );

  fireEvent.click(
    screen.getByRole("tab", { name: "Friends" })
  );

  const incoming = await screen.findByRole("region", {
    name: "Incoming Friend Requests",
  });

  const acceptButton = await within(incoming).findByRole(
    "button",
    { name: "Accept friend request from Alice" }
  );

  fireEvent.click(acceptButton);

  const accepted = screen.getByRole("region", {
    name: "Accepted Friends",
  });

  expect(
    await within(accepted).findByText("Alice")
  ).toBeInTheDocument();

  expect(
    leaderboardService.getAcceptedFriends
  ).toHaveBeenCalledTimes(2);
});