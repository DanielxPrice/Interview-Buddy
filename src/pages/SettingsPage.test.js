
import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import SettingsPage from "./SettingsPage";
import { userService } from "../services/userService";
import { settingsService } from "../services/settingsService";
import { PAGES } from "../utils/constants";
import { authService } from "../services/authService";

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

jest.mock("../services/authService", () => ({
  authService: {
    changePassword: jest.fn(),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockTheme = "Light";

  authService.changePassword.mockResolvedValue({
    success: true,
  });

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




function enterPasswords(current, next, confirmation) {
  fireEvent.change(
    screen.getByLabelText("Current Password"),
    { target: { value: current } }
  );

  fireEvent.change(
    screen.getByLabelText("New Password"),
    { target: { value: next } }
  );

  fireEvent.change(
    screen.getByLabelText("Confirm New Password"),
    { target: { value: confirmation } }
  );
}

test("renders active password fields and disabled account deletion", async () => {
  renderPage();

  await screen.findByDisplayValue("original_name");

  expect(
    screen.getByLabelText("Current Password")
  ).toHaveAttribute("type", "password");

  expect(
    screen.getByLabelText("New Password")
  ).toHaveAttribute("type", "password");

  expect(
    screen.getByLabelText("Confirm New Password")
  ).toHaveAttribute("type", "password");

  expect(
    screen.getByRole("button", { name: "Update Security" })
  ).toBeEnabled();

  expect(
    screen.getByRole("button", { name: "Delete Account" })
  ).toBeDisabled();
});

test("updates password and clears fields on success", async () => {
  renderPage();
  await screen.findByDisplayValue("original_name");

  enterPasswords(
    "oldPassword123",
    "newPassword123",
    "newPassword123"
  );

  fireEvent.click(
    screen.getByRole("button", { name: "Update Security" })
  );

  await waitFor(() => {
    expect(authService.changePassword).toHaveBeenCalledWith(
      "oldPassword123",
      "newPassword123"
    );
  });

  expect(
    await screen.findByText("Password updated successfully.")
  ).toBeInTheDocument();

  expect(
    screen.getByLabelText("Current Password")
  ).toHaveValue("");

  expect(
    screen.getByLabelText("New Password")
  ).toHaveValue("");

  expect(
    screen.getByLabelText("Confirm New Password")
  ).toHaveValue("");
});

test("rejects mismatched password confirmation", async () => {
  renderPage();
  await screen.findByDisplayValue("original_name");

  enterPasswords(
    "oldPassword123",
    "newPassword123",
    "differentPassword123"
  );

  fireEvent.click(
    screen.getByRole("button", { name: "Update Security" })
  );

  expect(
    await screen.findByRole("alert")
  ).toHaveTextContent("New passwords do not match.");

  expect(authService.changePassword).not.toHaveBeenCalled();
});

test("displays authentication errors without false success", async () => {
  authService.changePassword.mockRejectedValue(
    new Error("Current password is incorrect.")
  );

  renderPage();
  await screen.findByDisplayValue("original_name");

  enterPasswords(
    "wrongPassword",
    "newPassword123",
    "newPassword123"
  );

  fireEvent.click(
    screen.getByRole("button", { name: "Update Security" })
  );

  expect(
    await screen.findByRole("alert")
  ).toHaveTextContent("Current password is incorrect.");

  expect(
    screen.queryByText("Password updated successfully.")
  ).not.toBeInTheDocument();

  expect(
    screen.getByLabelText("New Password")
  ).toHaveValue("newPassword123");
});

test("prevents duplicate submissions while updating", async () => {
  let resolveUpdate;

  authService.changePassword.mockReturnValue(
    new Promise((resolve) => {
      resolveUpdate = resolve;
    })
  );

  renderPage();
  await screen.findByDisplayValue("original_name");

  enterPasswords(
    "oldPassword123",
    "newPassword123",
    "newPassword123"
  );

  fireEvent.click(
    screen.getByRole("button", { name: "Update Security" })
  );

  expect(
    screen.getByRole("button", { name: "Updating..." })
  ).toBeDisabled();

  expect(authService.changePassword).toHaveBeenCalledTimes(1);

  await act(async () => {
    resolveUpdate({ success: true });
  });

  expect(
    screen.getByText("Password updated successfully.")
  ).toBeInTheDocument();
});


