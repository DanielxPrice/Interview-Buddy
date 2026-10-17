
import React, { useEffect, useRef, useState } from "react";

import { PAGES } from "../../utils/constants";
import { authService } from "../../services/authService";
import { useAuth } from "../../context/AuthContext";
import ProfileBadge from "../common/ProfileBadge";

// Centralized navigation configuration.
// This keeps all sidebar destinations in one place.
const NAV_ITEMS = [
  {
    label: "Home",
    icon: "home",
    path: PAGES.DASHBOARD,
    activePaths: [PAGES.DASHBOARD],
  },
  {
    label: "Practice",
    icon: "practice",
    path: PAGES.INTERVIEW,
    activePaths: [
      PAGES.INTERVIEW,
      PAGES.INTERVIEW_SETUP,
      PAGES.SESSION_RESULTS,
    ],
  },
  {
    label: "History",
    icon: "history",
    path: PAGES.HISTORY,
    activePaths: [PAGES.HISTORY],
  },
  {
    label: "Ranking",
    icon: "ranking",
    path: PAGES.LEADERBOARD,
    activePaths: [PAGES.LEADERBOARD],
  },
  {
    label: "Stats",
    icon: "stats",
    path: PAGES.ANALYTICS,
    activePaths: [PAGES.ANALYTICS],
  },
  {
    label: "Settings",
    icon: "settings",
    path: PAGES.SETTINGS,
    activePaths: [
      PAGES.SETTINGS,
      PAGES.CHANGE_PASSWORD,
    ],
  },
];

// Local SVG icons avoid adding another npm dependency.
function SidebarIcon({ name }) {
  const icons = {
    home: (
      <>
        <path d="m3 10 9-7 9 7" />
        <path d="M5 9v12h14V9" />
        <path d="M9 21v-7h6v7" />
      </>
    ),
    practice: (
      <>
        <path d="m6 7 4-4 4 4-4 4z" />
        <path d="m10 11 4-4 4 4-4 4z" />
        <path d="m14 15 4-4 4 4-4 4z" />
        <path d="M3 14 7 10M17 6l4 4" />
      </>
    ),
    history: (
      <>
        <path d="M3 12a9 9 0 1 0 3-6.7" />
        <path d="M3 3v6h6" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    ranking: (
      <>
        <path d="M3 21h18" />
        <rect x="5" y="12" width="4" height="9" rx="1" />
        <rect x="10" y="5" width="4" height="16" rx="1" />
        <rect x="15" y="9" width="4" height="12" rx="1" />
      </>
    ),
    stats: (
      <>
        <path d="M3 17 8 12l4 3 5-9 4 2" />
        <path d="M3 21h18" />
        <circle cx="8" cy="12" r="1" />
        <circle cx="17" cy="6" r="1" />
      </>
    ),
    settings: (
      <>
        <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />
        <path d="M10 2h4l.6 2.5 2 .9 2.2-1.3 2.8 2.8-1.3 2.2.9 2L23.5 12l-2.3 1-.9 2 1.3 2.2-2.8 2.8-2.2-1.3-2 .9L14 22h-4l-.6-2.4-2-.9-2.2 1.3-2.8-2.8 1.3-2.2-.9-2L.5 12l2.3-1 .9-2-1.3-2.2 2.8-2.8 2.2 1.3 2-.9z" />
      </>
    ),
    logout: (
      <>
        <path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" />
        <path d="M14 7l5 5-5 5" />
        <path d="M19 12H9" />
      </>
    ),
  };

  return (
    <svg
      className="sidebarNavIcon"
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {icons[name]}
    </svg>
  );
}

function Sidebar({ currentPage, onNavigate, badgeSrc }) {
  const { user, profile } = useAuth();

  const [showLogoutDialog, setShowLogoutDialog] =
    useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  const cancelButtonRef = useRef(null);

  // Use the profile username rather than hardcoded initials.
  const username =
    profile?.username ||
    user?.username ||
    user?.email?.split("@")[0] ||
    "User";

  function handleLogoutClick() {
    setLogoutError("");
    setShowLogoutDialog(true);
  }

  function handleCancelLogout() {
    if (isLoggingOut) return;

    setShowLogoutDialog(false);
    setLogoutError("");
  }

  async function handleConfirmLogout() {
    if (isLoggingOut) return;

    setIsLoggingOut(true);
    setLogoutError("");

    try {
      // Preserve the existing Firebase logout service.
      await authService.logout();

      setShowLogoutDialog(false);
      onNavigate(PAGES.LOGIN);
    } catch (error) {
      // Do not navigate away if logout fails.
      setLogoutError(
        error?.message ||
          "Unable to log out. Please try again."
      );
    } finally {
      setIsLoggingOut(false);
    }
  }

  // Support Escape and keyboard focus in the dialog.
  useEffect(() => {
    if (!showLogoutDialog) return undefined;

    cancelButtonRef.current?.focus();

    function handleKeyDown(event) {
      if (event.key === "Escape" && !isLoggingOut) {
        setShowLogoutDialog(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener(
        "keydown",
        handleKeyDown
      );
    };
  }, [showLogoutDialog, isLoggingOut]);

  return (
    <>
      <aside className="sidebar" aria-label="Application sidebar">

        {/* Horizontal Interview Buddy logo */}
        <div className="sidebarTop">
          <button
            type="button"
            className="sidebarBrand"
            onClick={() => onNavigate(PAGES.DASHBOARD)}
            aria-label="Go to Interview Buddy dashboard"
          >
            <picture>
              <source
                media="(max-width: 760px)"
                srcSet="/IBlogo-dark.png"
              />
              <img
                src="/IBlogo-dark-horizontal.png"
                alt=""
                className="sidebarBrandLogo"
              />
            </picture>
          </button>
        </div>

        {/* Reusable badge slot */}
        <div className="sidebarBadgeArea">
          <ProfileBadge
            imageSrc={badgeSrc}
            username={username}
          />
        </div>

        {/* Primary navigation */}
        <nav
          className="sidebarNav"
          aria-label="Primary navigation"
        >
          {NAV_ITEMS.map((item) => {
            const isActive =
              item.activePaths.includes(currentPage);

            return (
              <button
                key={item.path}
                type="button"
                className={
                  isActive
                    ? "sidebarButton active"
                    : "sidebarButton"
                }
                aria-label={item.label}
                aria-current={isActive ? "page" : undefined}
                title={item.label}
                onClick={() => onNavigate(item.path)}
              >
                <SidebarIcon name={item.icon} />

                <span className="sidebarNavLabel">
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Always at the bottom of the sidebar */}
        <div className="sidebarBottom">
          <div className="sidebarUserInfo">
            <span className="sidebarUserCaption">
              SIGNED IN AS
            </span>

            <span
              className="sidebarUsername"
              title={username}
            >
              {username}
            </span>
          </div>

          <button
            type="button"
            className="sidebarLogoutButton"
            onClick={handleLogoutClick}
            aria-label="Logout"
          >
            <SidebarIcon name="logout" />
            <span className="sidebarLogoutLabel">
              Logout
            </span>
          </button>
        </div>
      </aside>

      {/* Existing logout confirmation, restyled */}
      {showLogoutDialog && (
        <div
          className="ib-logout-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              handleCancelLogout();
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="logoutDialogTitle"
            aria-describedby="logoutDialogDescription"
            className="ib-logout-dialog"
          >
            <h2 id="logoutDialogTitle">
              Log out of Interview Buddy?
            </h2>

            <p id="logoutDialogDescription">
              Are you sure you want to log out? You
              will need to sign back in to continue
              practicing.
            </p>

            {logoutError && (
              <p className="ib-logout-error" role="alert">
                {logoutError}
              </p>
            )}

            <div className="ib-logout-actions">
              <button
                ref={cancelButtonRef}
                type="button"
                className="ib-button ib-button--secondary"
                onClick={handleCancelLogout}
                disabled={isLoggingOut}
              >
                Cancel
              </button>

              <button
                type="button"
                className="ib-button ib-button--primary"
                onClick={handleConfirmLogout}
                disabled={isLoggingOut}
              >
                {isLoggingOut
                  ? "Logging out..."
                  : "Yes, log out"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default Sidebar;
