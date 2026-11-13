import React, { useEffect, useMemo, useState } from "react";
import PageLayout from "../components/layout/PageLayout";
import { useAuth } from "../context/AuthContext";
import { leaderboardService } from "../services/leaderboardService";
import { getEloRankBadge } from "../utils/eloRankBadge";
import StateRenderer from "../components/state/StateRenderer";

const PAGE_SIZE = 5;
const scoreFormatter = new Intl.NumberFormat("en-US");
const initialCollection = { status: "loading", data: [], error: "" };
const initialRanking = { status: "loading", data: null, error: "" };

const emptyRequests = { incoming: [], outgoing: [] };

const initialRequests = {
  status: "loading",
  data: emptyRequests,
  error: "",
};

function resolveResult(result, fallback) {
  if (result.status === "fulfilled") {
    return { status: "success", data: result.value, error: "" };
  }
  return {
    status: result.reason?.code === "feature-unavailable" ? "unavailable" : "error",
    data: fallback,
    error: result.reason?.message || "Unable to retrieve data.",
  };
}

function RankBadge({ rank }) {
  const placement = rank >= 1 && rank <= 3 ? ` ibRankingRank--${rank}` : "";
  return <span className={`ibRankingRank${placement}`}>{rank == null ? "—" : rank}</span>;
}

function RankingMessage({ title = "Loading rankings", children, type = "status" }) {
  return (
    <div className="ibRankingEmpty" role={type}>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}

function RankingTable({ data, currentUserId, currentUsername, onRemove, saving = false }) {
  const { status, error, data: users } = data;
  if (status === "loading") {
    return <RankingMessage>Loading rankings from the server...</RankingMessage>;
  }
  if (status === "unavailable") {
    return <RankingMessage title="Ranking data is not available yet">This feature is waiting for the database-backed leaderboard and friends API.</RankingMessage>;
  }
  if (status === "error") {
    return <RankingMessage title="Unable to load rankings" type="alert">{error}</RankingMessage>;
  }
  if (!users.length) {
    return <RankingMessage title="No available data">There are no rankings to display yet.</RankingMessage>;
  }

  return (
    <div className="ibRankingTableScroll">
      <table className="ibRankingTable">
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col">User</th>
            <th scope="col">ELO Score</th>
            {onRemove && <th scope="col" className="ibRankingActionHeading">Action</th>}
          </tr>
        </thead>
        <tbody>
          {users.map((entry, index) => {
            const isCurrentUser = currentUserId != null && entry.uid != null
              ? String(entry.uid) === String(currentUserId)
              : Boolean(currentUsername) && entry.username.toLowerCase() === currentUsername.toLowerCase();
            return (
              <tr key={entry.uid != null ? String(entry.uid) : `${entry.username}-${index}`} className={isCurrentUser ? "ibRankingTableRow--current" : ""}>
                <td><RankBadge rank={entry.rank} /></td>
                <td>
                  <div className="ibRankingUser">
                    <span className="ibRankingUsername">{entry.username}</span>
                    {isCurrentUser && <span className="ibRankingYou">You</span>}
                  </div>
                </td>
                <td className="ibRankingScore">{entry.elo == null ? "—" : scoreFormatter.format(entry.elo)}</td>
                {onRemove && (
                  <td className="ibRankingActionCell">
                    <button
                      type="button"
                      className="ibRankingRemoveButton"
                      disabled={entry.uid == null || saving}
                      title={entry.uid == null ? "Friend ID is not available" : undefined}
                      onClick={() => onRemove(entry)}
                      aria-label={`Remove ${entry.username} from friends`}
                    >
                      Remove
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FriendRequestsPanel({
  title,
  direction,
  requests,
  emptyMessage,
  onAccept,
  onDecline,
  saving = false,
}) {
  const { status, error, data } = requests;
  const entries = Array.isArray(data?.[direction])
    ? data[direction]
    : [];

  const renderStatus =
    status === "unavailable" ? "error" : status;

  return (
    <section className="ibRankingPanel" aria-label={title}>
      <div className="ibRankingPanelTitle">
        <h2>{title}</h2>
        <span>
          {status === "success"
            ? `${entries.length} pending`
            : "—"}
        </span>
      </div>

      <div className="ibRankingRequestBody">
        <StateRenderer
          status={renderStatus}
          data={entries}
          error={error || "Unable to load friend requests."}
          empty
          emptyTitle={`No ${direction} requests`}
          emptyDescription={emptyMessage}
        >
          <ul className="ibRankingRequestList">
            {entries.map((entry) => (
              <li
                className="ibRankingRequestRow"
                key={entry.id}
              >
                <strong>
                  {entry.user?.username || "Account unavailable"}
                </strong>

                <div className="ibRankingRequestActions">
                  <span className="ibRankingPendingLabel">
                    Pending
                  </span>

                  {direction === "incoming" && (
                    <>
                      <button
                        type="button"
                        className="ibRankingAcceptButton"
                        disabled={saving || !entry.requesterUid}
                        onClick={() => onAccept(entry)}
                        aria-label={`Accept friend request from ${entry.user?.username || "unknown user"}`}
                      >
                        Accept
                      </button>

                      <button
                        type="button"
                        className="ibRankingDeclineButton"
                        disabled={saving || !entry.requesterUid}
                        onClick={() => onDecline(entry)}
                        aria-label={`Decline friend request from ${entry.user?.username || "unknown user"}`}
                      >
                        Decline
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </StateRenderer>
      </div>
    </section>
  );
}

//Panel for all accepted friends
function AcceptedFriendsPanel({
  friends,
  onRemove,
  saving = false,
}) {
  const { status, error, data } = friends;
  const entries = Array.isArray(data) ? data : [];

  const renderStatus =
    status === "unavailable" ? "error" : status;

  return (
    <section
      className="ibRankingPanel"
      aria-label="Accepted Friends"
    >
      <div className="ibRankingPanelTitle">
        <h2>Accepted Friends</h2>
        <span>
          {status === "success"
            ? `${entries.length} accepted`
            : "—"}
        </span>
      </div>

      <div className="ibRankingRequestBody">
        <StateRenderer
          status={renderStatus}
          data={entries}
          error={error || "Unable to load accepted friends."}
          empty
          emptyTitle="No accepted friends"
          emptyDescription="Accepted friends will appear here after they approve your request."
        >
          <ul className="ibRankingRequestList">
            {entries.map((friend) => (
              <li
                className="ibRankingRequestRow"
                key={friend.uid}
              >
                <strong>{friend.username}</strong>

                <button
                  type="button"
                  className="ibRankingRemoveButton"
                  disabled={saving}
                  onClick={() => onRemove(friend)}
                  aria-label={`Remove ${friend.username} from accepted friends`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </StateRenderer>
      </div>
    </section>
  );
}

function LeaderboardPage({ currentPage, onNavigate }) {
  const { user } = useAuth();
  const [global, setGlobal] = useState(initialCollection);
  const [friends, setFriends] = useState(initialCollection);
  const [acceptedFriends, setAcceptedFriends] = useState(initialCollection);
  const [standing, setStanding] = useState(initialRanking);
  const [requests, setRequests] = useState(initialRequests);
  const [activeTab, setActiveTab] = useState("global");
  const [visibleGlobal, setVisibleGlobal] = useState(PAGE_SIZE);
  const [visibleFriends, setVisibleFriends] = useState(PAGE_SIZE);
  const [refreshKey, setRefreshKey] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [addStatus, setAddStatus] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setGlobal(initialCollection);
    setFriends(initialCollection);
    setAcceptedFriends(initialCollection);
    setStanding(initialRanking);
    setRequests(initialRequests);

    // Fetch each dataset independently: a missing endpoint must not hide
    // another endpoint's valid response if the backend is implemented in stages.
    // Load rankings and friend requests independently.
    Promise.allSettled([
      leaderboardService.getGlobalLeaderboard(),
      leaderboardService.getFriendsLeaderboard(),
      leaderboardService.getUserRanking(),
      leaderboardService.getFriendRequests(),
      leaderboardService.getAcceptedFriends(),
    ]).then(([
      globalResult,
      friendsResult,
      standingResult,
      requestsResult,
      acceptedResult,
    ]) => {
      if (!active) return;

      setGlobal(resolveResult(globalResult, []));
      setFriends(resolveResult(friendsResult, []));
      setStanding(resolveResult(standingResult, null));
      setRequests(resolveResult(requestsResult, emptyRequests));
      setAcceptedFriends(resolveResult(acceptedResult, []));
    });

    //Cleanup
    return () => { active = false; };
  }, [user?.uid, refreshKey]);

  const friendRankings = useMemo(() => friends.data, [friends.data]);
  const currentUser = standing.status === "success" ? standing.data : null;
  const rankBadge = getEloRankBadge(currentUser?.elo);
  const hasFriends = acceptedFriends.status === "success";
  const friendCount = hasFriends ? acceptedFriends.data.length : null;
  const rankedFriendCount = friends.status === "success" ? friendRankings.length : null;

  //Make sure no items are loading
  const canRefresh = [
    global,
    friends,
    standing,
    requests,
    acceptedFriends,
  ].every((item) => item.status !== "loading");

  function refresh() {
    setVisibleGlobal(PAGE_SIZE);
    setVisibleFriends(PAGE_SIZE);
    setAddStatus(null);
    setRefreshKey((previous) => previous + 1);
  }

  async function reloadFriends() {
    try {
      const records = await leaderboardService.getFriendsLeaderboard();
      setFriends({ status: "success", data: records, error: "" });
    } catch (error) {
      setFriends(resolveResult({ status: "rejected", reason: error }, []));
    }
  }

  async function reloadRequests() {
    try {
      const records = await leaderboardService.getFriendRequests();

      setRequests({
        status: "success",
        data: records,
        error: "",
      });
    } catch (error) {
      setRequests(
        resolveResult(
          { status: "rejected", reason: error },
          emptyRequests
        )
      );
    }
  }

  async function reloadAcceptedFriends() {
    try {
      const records = await leaderboardService.getAcceptedFriends();

      setAcceptedFriends({
        status: "success",
        data: records,
        error: "",
      });
    } catch (error) {
      setAcceptedFriends(
        resolveResult(
          { status: "rejected", reason: error },
          []
        )
      );
    }
  }

  //Only update display after BE performs action successfully, then reload BE
  async function handleRespondToRequest(entry, action) {
    if (saving || !entry?.requesterUid) return;

    setSaving(true);
    setAddStatus(null);

    const username = entry.user?.username || "this user";

    try {
      if (action === "accept") {
        await leaderboardService.acceptFriendRequest(
          entry.requesterUid
        );
      } else if (action === "decline") {
        await leaderboardService.declineFriendRequest(
          entry.requesterUid
        );
      } else {
        throw new Error("Invalid friend request action.");
      }

      // Get the authoritative state from the backend.
      await Promise.all([
        reloadRequests(),
        reloadFriends(),
        reloadAcceptedFriends(),
      ]);

      setAddStatus({
        type: "success",
        message:
          action === "accept"
            ? `Friend request from "${username}" accepted.`
            : `Friend request from "${username}" declined.`,
      });
    } catch (error) {
      setAddStatus({
        type: "error",
        message:
          error.message ||
          "Unable to update the friend request.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleAddFriend(event) {
    event.preventDefault();
    const name = searchInput.trim();
    if (!name || !hasFriends || saving) return;
    setSaving(true);
    setAddStatus(null);
    try {
      await leaderboardService.sendFriendRequest(name);
      setAddStatus({ type: "success", message: `Friend request sent to "${name}". They will appear after accepting.` });
      setSearchInput("");
      await Promise.all([
        reloadFriends(),
        reloadRequests(),
      ]);
    } catch (error) {
      setAddStatus({ type: "error", message: error.message || "Unable to send the friend request." });
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveFriend(friend) {
    if (saving || friend.uid == null) return;
    setSaving(true);
    setAddStatus(null);
    try {
      await leaderboardService.removeFriend(friend.uid);
      await Promise.all([
        reloadFriends(),
        reloadAcceptedFriends(),
      ]);
      setAddStatus({ type: "success", message: `Removed "${friend.username}" from your friends.` });
    } catch (error) {
      setAddStatus({ type: "error", message: error.message || "Unable to remove the friend." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageLayout
      title="Leaderboard"
      subtitle="See how you stack up against other interviewees."
      currentPage={currentPage}
      onNavigate={onNavigate}
    >
      <div className="ibRankingPage">
        <div className="ibRankingMain">
          <div className="ibRankingToolbar">
            <div className="ibRankingTabs" role="tablist" aria-label="Leaderboard views">
              <button type="button" role="tab" id="ib-global-tab" aria-selected={activeTab === "global"} aria-controls="ib-global-panel" className={activeTab === "global" ? "ibRankingTab is-active" : "ibRankingTab"} onClick={() => setActiveTab("global")}>Global</button>
              <button type="button" role="tab" id="ib-friends-tab" aria-selected={activeTab === "friends"} aria-controls="ib-friends-panel" className={activeTab === "friends" ? "ibRankingTab is-active" : "ibRankingTab"} onClick={() => setActiveTab("friends")}>Friends</button>
            </div>
            <div className="ibRankingToolbarActions">
              <p className="ibRankingToolbarNote">
                {activeTab === "global" ? "Global rankings" : friendCount == null ? "Friends not available" : `${friendCount} ${friendCount === 1 ? "friend" : "friends"} in your list`}
              </p>
              <button type="button" className="ibRankingRefresh" disabled={!canRefresh || saving} onClick={refresh}>↻ Refresh</button>
            </div>
          </div>

          {activeTab === "global" ? (
            <section className="ibRankingPanel" role="tabpanel" id="ib-global-panel" aria-labelledby="ib-global-tab">
              <RankingTable data={{ ...global, data: global.data.slice(0, visibleGlobal) }} currentUserId={user?.uid} currentUsername={currentUser?.username} />
              {global.status === "success" && visibleGlobal < global.data.length && (
                <button type="button" className="ibRankingLoadMore" onClick={() => setVisibleGlobal((count) => count + PAGE_SIZE)}>Load More Rankings</button>
              )}
            </section>
          ) : (
            <div id="ib-friends-panel" role="tabpanel" aria-labelledby="ib-friends-tab" className="ibRankingFriendsContent">
              <section className="ibRankingAddCard" aria-labelledby="ib-add-friend-title">
                <div className="ibRankingAddHeading">
                  <div>
                    <h2 id="ib-add-friend-title">Add a Friend</h2>
                    <p>Send a request by username when the friends service is available.</p>
                  </div>
                  <span className="ibRankingAddIcon" aria-hidden="true">+</span>
                </div>
                <form className="ibRankingAddForm" onSubmit={handleAddFriend}>
                  <label className="ibRankingVisuallyHidden" htmlFor="ib-friend-username">Username</label>
                  <input id="ib-friend-username" type="text" autoComplete="off" placeholder="Enter a username..." value={searchInput} disabled={!hasFriends || saving} onChange={(event) => { setSearchInput(event.target.value); setAddStatus(null); }} />
                  <button type="submit" disabled={!hasFriends || !searchInput.trim() || saving}>{saving ? "Saving..." : "Add Friend"}</button>
                </form>
                {!hasFriends && <p className="ibRankingFormHint">Friend requests are unavailable until the friends backend is implemented.</p>}
                {addStatus && <p className={`ibRankingFormStatus ibRankingFormStatus--${addStatus.type}`} role="status">{addStatus.message}</p>}
              </section>

              <FriendRequestsPanel
                title="Incoming Friend Requests"
                direction="incoming"
                requests={requests}
                emptyMessage="No incoming friend requests."
                onAccept={(entry) => handleRespondToRequest(entry, "accept")}
                onDecline={(entry) => handleRespondToRequest(entry, "decline")}
                saving={saving}
              />

              <FriendRequestsPanel
                title="Sent Friend Requests"
                direction="outgoing"
                requests={requests}
                emptyMessage="No outgoing friend requests."
              />

              <AcceptedFriendsPanel
                friends={acceptedFriends}
                onRemove={handleRemoveFriend}
                saving={saving}
              />

              <section className="ibRankingPanel" aria-label="Friends leaderboard">
                <div className="ibRankingPanelTitle">
                  <h2>Friends Rankings</h2>
                  <span>
                    {rankedFriendCount == null
                      ? "No available data"
                      : `${rankedFriendCount} ranked ${
                          rankedFriendCount === 1 ? "friend" : "friends"
                        }`}
                  </span>
                </div>
                <RankingTable data={{ ...friends, data: friends.data.slice(0, visibleFriends) }} currentUserId={user?.uid} currentUsername={currentUser?.username} onRemove={hasFriends ? handleRemoveFriend : undefined} saving={saving} />
                {friends.status === "success" && visibleFriends < friends.data.length && (
                  <button type="button" className="ibRankingLoadMore" onClick={() => setVisibleFriends((count) => count + PAGE_SIZE)}>Load More Friends</button>
                )}
              </section>
            </div>
          )}
          <p className="ibRankingFootnote">Global and friends rankings are ordered by ELO. Complete at least five questions in an interview to earn or lose ELO. No sample rankings are displayed.</p>
        </div>

        <aside className="ibRankingAside" aria-label="Ranking summary">
          <section className="ibRankingStandingCard" aria-labelledby="ib-your-standing">
            <div className="ibRankingStandingBadge">
              {rankBadge ? (
                <img
                  src={rankBadge.src}
                  alt={`${rankBadge.name} ELO rank badge`}
                  title={`${rankBadge.name} rank badge`}
                />
              ) : (
                <span className="ibRankingStandingBadgePlaceholder" role="img" aria-label="Rank badge unavailable">
                  ?
                </span>
              )}
            </div>
            <p className="ibRankingEyebrow" id="ib-your-standing">Your Standing</p>
            <div className="ibRankingStandingValue">
              <strong>{currentUser?.rank != null ? `#${currentUser.rank}` : "—"}</strong>
              <span>Global Rank</span>
            </div>
            <div className="ibRankingStandingStats">
              <div><span>Current ELO</span><strong>{currentUser?.elo != null ? scoreFormatter.format(currentUser.elo) : "—"}</strong></div>
              <div><span>Friends</span><strong>{friendCount == null ? "—" : friendCount}</strong></div>
            </div>
            {standing.status === "loading" && <p className="ibRankingStandingHint">Loading your standing...</p>}
            {standing.status === "unavailable" && <p className="ibRankingStandingHint">Your ranking is not available yet.</p>}
            {standing.status === "error" && <p className="ibRankingStandingHint">Unable to load your standing.</p>}
            {standing.status === "success" && !currentUser && <p className="ibRankingStandingHint">You do not have a ranking yet.</p>}
          </section>

          <section className="ibRankingSideCard" aria-labelledby="ib-friends-overview">
            <div className="ibRankingSideTitle"><h2 id="ib-friends-overview">Your Friends</h2><span className="ibRankingCount">{friendCount == null ? "—" : friendCount}</span></div>
            {acceptedFriends.status === "loading" ? (
              <p className="ibRankingNoFriends">
                Loading friends...
              </p>
            ) : acceptedFriends.status !== "success" ? (
              <p className="ibRankingNoFriends">
                Friends data is not available yet.
              </p>
            ) : acceptedFriends.data.length > 0 ? (
              <div className="ibRankingFriendPreview">
                {acceptedFriends.data.slice(0, 3).map((friend) => {
                  const ranking = friendRankings.find(
                    (entry) => entry.uid === friend.uid
                  );

                  return (
                    <div className="ibRankingPreviewRow" key={friend.uid}>
                      <div>
                        <strong>{friend.username}</strong>
                        <span>
                          {ranking?.rank == null
                            ? "Not ranked yet"
                            : `Rank #${ranking.rank}`}
                        </span>
                      </div>

                      <span className="ibRankingPreviewScore">
                        {ranking?.elo == null
                          ? "ELO unavailable"
                          : `${scoreFormatter.format(ranking.elo)} ELO`}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="ibRankingNoFriends">
                No friends available yet.
              </p>
            )}
            {activeTab !== "friends" && <button type="button" className="ibRankingViewFriends" onClick={() => setActiveTab("friends")}>View Friends</button>}
          </section>
        </aside>
      </div>
    </PageLayout>
  );
}

export default LeaderboardPage;
