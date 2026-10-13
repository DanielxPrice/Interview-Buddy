
import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import Sidebar from "./Sidebar";
import ProfileBadge from "../common/ProfileBadge";
import { PAGES } from "../../utils/constants";
import { useAuth } from "../../context/AuthContext";
import { authService } from "../../services/authService";

jest.mock("../../context/AuthContext", () => ({
  useAuth: jest.fn(),
}));

jest.mock("../../services/authService", () => ({
  authService: {
    logout: jest.fn(),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();

  useAuth.mockReturnValue({
    user: {
      uid: "test-user",
      username: "FallbackName",
      email: "test@example.com",
    },
    profile: {
      username: "DPhoenix",
    },
  });

  authService.logout.mockResolvedValue(undefined);
});

function renderSidebar(currentPage = PAGES.SETTINGS) {
  const onNavigate = jest.fn();

  render(
    <Sidebar
      currentPage={currentPage}
      onNavigate={onNavigate}
    />
  );

  return onNavigate;
}

test("renders the logo, graduate badge and username", () => {
  renderSidebar();

  expect(
    screen.getByRole("button", {
      name: "Go to Interview Buddy dashboard",
    })
  ).toBeInTheDocument();

  expect(
    screen.getByAltText("Cheerful graduate mascot badge")
  ).toHaveAttribute(
    "src",
    "/Cheerful%20Graduate%20Mascot%20Badge.png"
  );

  expect(
    screen.getByText("DPhoenix")
  ).toBeInTheDocument();
});

test("highlights the current page and preserves navigation", () => {
  const onNavigate = renderSidebar(PAGES.SETTINGS);

  expect(
    screen.getByRole("button", { name: "Settings" })
  ).toHaveAttribute("aria-current", "page");

  fireEvent.click(
    screen.getByRole("button", { name: "History" })
  );

  expect(onNavigate).toHaveBeenCalledWith(
    PAGES.HISTORY
  );
});

test("allows the user to cancel logout", () => {
  renderSidebar();

  fireEvent.click(
    screen.getByRole("button", { name: "Logout" })
  );

  expect(
    screen.getByRole("dialog")
  ).toBeInTheDocument();

  fireEvent.click(
    screen.getByRole("button", { name: "Cancel" })
  );

  expect(
    screen.queryByRole("dialog")
  ).not.toBeInTheDocument();

  expect(authService.logout).not.toHaveBeenCalled();
});

test("logs out through the existing auth service", async () => {
  const onNavigate = renderSidebar();

  fireEvent.click(
    screen.getByRole("button", { name: "Logout" })
  );

  fireEvent.click(
    screen.getByRole("button", { name: "Yes, log out" })
  );

  await waitFor(() => {
    expect(authService.logout).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith(PAGES.LOGIN);
  });
});

test("does not navigate to login if logout fails", async () => {
  authService.logout.mockRejectedValue(
    new Error("Unable to sign out")
  );

  const onNavigate = renderSidebar();

  fireEvent.click(
    screen.getByRole("button", { name: "Logout" })
  );

  fireEvent.click(
    screen.getByRole("button", { name: "Yes, log out" })
  );

  expect(
    await screen.findByRole("alert")
  ).toHaveTextContent("Unable to sign out");

  expect(onNavigate).not.toHaveBeenCalled();
});

test("profile badge supports a different image source", () => {
  render(
    <ProfileBadge
      imageSrc="/another-badge.png"
      badgeAlt="Custom achievement badge"
      username="DPhoenix"
    />
  );

  expect(
    screen.getByAltText("Custom achievement badge")
  ).toHaveAttribute("src", "/another-badge.png");
});

test("shows initials if a badge image fails", () => {
  render(
    <ProfileBadge
      imageSrc="/missing-badge.png"
      username="DPhoenix"
    />
  );

  fireEvent.error(
    screen.getByAltText("Cheerful graduate mascot badge")
  );

  expect(
    screen.getByRole("img", {
      name: "DPhoenix's profile",
    })
  ).toHaveTextContent("DP");
});
