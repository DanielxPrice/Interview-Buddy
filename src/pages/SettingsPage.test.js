
import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import SettingsPage from "./SettingsPage";
import { userService } from "../services/userService";
import { settingsService } from "../services/settingsService";
import { PAGES } from "../utils/constants";

import { useAuth } from "../context/AuthContext";

const mockSetTheme = jest.fn();
let mockTheme = "Light";

jest.mock("../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: mockTheme,
    setTheme: mockSetTheme,
  }),
}));

jest.mock("../components/layout/PageLayout", () => ({
  children,
}) => <main>{children}</main>);

jest.mock("../services/userService", () => ({
  userService: {
    getProfile: jest.fn(),
    updateProfile: jest.fn(),
  },
}));


jest.mock("../context/AuthContext", () => ({
  useAuth: jest.fn(),
}));


jest.mock("../services/settingsService", () => ({
  settingsService: {
    getSettings: jest.fn(),
    updateSettings: jest.fn(),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockTheme = "Light";

  useAuth.mockReturnValue({
    updateProfileCache: jest.fn(),
  });

  userService.getProfile.mockResolvedValue({
    username: "original_name",
    email: "alex@example.com",
  });

  settingsService.getSettings.mockResolvedValue({
    theme: "light",
    notifications: false,
  });

  userService.updateProfile.mockResolvedValue({
    username: "new_name",
  });

  settingsService.updateSettings.mockResolvedValue({});
});


function renderPage(onNavigate = jest.fn()) {
  render(
    <SettingsPage
      currentPage={PAGES.SETTINGS}
      onNavigate={onNavigate}
    />
  );

  return { onNavigate };
}




test("loads persisted profile and theme preference", async () => {
  renderPage();

  // Verify username loads from the profile service
  expect(
    await screen.findByDisplayValue("original_name")
  ).toBeInTheDocument();

  // Verify email loads and cannot be edited
  expect(
    screen.getByDisplayValue("alex@example.com")
  ).toHaveAttribute("readonly");

  // Verify the saved Light theme is selected
  expect(
    screen.getByRole("button", { name: "Light" })
  ).toHaveAttribute("aria-pressed", "true");

  // Verify Dark mode is not selected
  expect(
    screen.getByRole("button", { name: "Dark" })
  ).toHaveAttribute("aria-pressed", "false");
});



test("saves username through profile service", async () => {
  renderPage();

  const input = await screen.findByLabelText("Username");

  fireEvent.change(input, {
    target: { value: "new_name" },
  });

  fireEvent.click(
    screen.getByRole("button", {
      name: "Save Profile Changes",
    })
  );

  await waitFor(() => {
    expect(userService.updateProfile).toHaveBeenCalledWith({
      username: "new_name",
    });
  });

  expect(
    await screen.findByText("Profile changes saved.")
  ).toBeInTheDocument();
});

test("displays profile saving errors", async () => {
  userService.updateProfile.mockRejectedValue(
    new Error("Username already taken")
  );

  renderPage();

  const input = await screen.findByLabelText("Username");

  fireEvent.change(input, {
    target: { value: "taken" },
  });

  fireEvent.click(
    screen.getByRole("button", {
      name: "Save Profile Changes",
    })
  );

  expect(
    await screen.findByRole("alert")
  ).toHaveTextContent("Username already taken");
});

test("saves selected theme", async () => {
  renderPage();

  await screen.findByDisplayValue("original_name");

  fireEvent.click(
    screen.getByRole("button", { name: "Dark" })
  );

  
    await waitFor(() => {
    expect(
        settingsService.updateSettings
    ).toHaveBeenCalledWith({ theme: "dark" });
    });

    expect(mockSetTheme).toHaveBeenCalledWith("Dark");

});

test("does not change theme when saving fails", async () => {
  settingsService.updateSettings.mockRejectedValue(
    new Error("Network unavailable")
  );

  renderPage();

  await screen.findByDisplayValue("original_name");

  mockSetTheme.mockClear();

  fireEvent.click(
    screen.getByRole("button", { name: "Dark" })
  );

  expect(
    await screen.findByRole("alert")
  ).toHaveTextContent("Network unavailable");

  expect(mockSetTheme).not.toHaveBeenCalled();
});



test("renders inline password fields and disables unfinished actions", async () => {
  const { onNavigate } = renderPage();

  await screen.findByDisplayValue("original_name");

  // All three password fields appear on Settings.
  const currentPassword =
    screen.getByLabelText("Current Password");

  const newPassword =
    screen.getByLabelText("New Password");

  const confirmPassword =
    screen.getByLabelText("Confirm New Password");

  expect(currentPassword).toHaveAttribute(
    "type",
    "password"
  );

  expect(newPassword).toHaveAttribute(
    "type",
    "password"
  );

  expect(confirmPassword).toHaveAttribute(
    "type",
    "password"
  );

  // Users can type into the UI-only fields.
  fireEvent.change(newPassword, {
    target: { value: "ExamplePassword123!" },
  });

  expect(newPassword).toHaveValue(
    "ExamplePassword123!"
  );

  // Password saving is not implemented yet.
  expect(
    screen.getByRole("button", {
      name: "Update Security",
    })
  ).toBeDisabled();

  // Account deletion is also still unavailable.
  expect(
    screen.getByRole("button", {
      name: "Delete Account",
    })
  ).toBeDisabled();

  // Settings no longer navigates to a password page.
  expect(onNavigate).not.toHaveBeenCalled();
});

