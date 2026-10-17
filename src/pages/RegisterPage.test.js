
import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import RegisterPage from "./RegisterPage";
import { authService } from "../services/authService";

jest.mock("../services/authService", () => ({
  authService: {
    register: jest.fn(),
  },
}));

function renderRegistration() {
  const onRegister = jest.fn();
  const onGoToLogin = jest.fn();

  render(
    <RegisterPage
      onRegister={onRegister}
      onGoToLogin={onGoToLogin}
    />
  );

  return { onRegister, onGoToLogin };
}

function fillForm({
  username = "practiceUser",
  email = "test@example.com",
  password = "password123",
  confirmPassword = "password123",
} = {}) {
  fireEvent.change(
    screen.getByPlaceholderText("Username"),
    { target: { value: username } }
  );

  fireEvent.change(
    screen.getByPlaceholderText("Email"),
    { target: { value: email } }
  );

  fireEvent.change(
    screen.getByPlaceholderText("Password"),
    { target: { value: password } }
  );

  fireEvent.change(
    screen.getByPlaceholderText("Confirm Password"),
    { target: { value: confirmPassword } }
  );
}

function submitForm() {
  fireEvent.click(
    screen.getByRole("button", {
      name: "Create Account",
    })
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

test("shows the redesigned form and login navigation", () => {
  const { onGoToLogin } = renderRegistration();

  expect(
    screen.getByRole("heading", {
      name: "Create Account",
    })
  ).toBeInTheDocument();

  expect(
    screen.getByLabelText("Username")
  ).toBeInTheDocument();

  expect(
    screen.getByLabelText("Email address")
  ).toBeInTheDocument();

  expect(
    screen.getByLabelText("Password")
  ).toBeInTheDocument();

  expect(
    screen.getByLabelText("Confirm Password")
  ).toBeInTheDocument();

  fireEvent.click(
    screen.getByRole("button", {
      name: "Back to Login",
    })
  );

  expect(onGoToLogin).toHaveBeenCalledTimes(1);
});

test("requires all four registration fields", () => {
  renderRegistration();
  submitForm();

  expect(screen.getByRole("alert")).toHaveTextContent(
    "Please complete all fields."
  );

  expect(authService.register).not.toHaveBeenCalled();
});

test("rejects HTML tag input in the username", () => {
  renderRegistration();

  fillForm({
    username: '<script>alert("Hacked!")</script>',
  });

  submitForm();

  expect(screen.getByRole("alert")).toHaveTextContent(
    "Username contains invalid characters."
  );

  expect(authService.register).not.toHaveBeenCalled();
});

test("rejects invalid email addresses", () => {
  renderRegistration();

  fillForm({
    email: "not-an-email",
  });

  submitForm();

  expect(screen.getByRole("alert")).toHaveTextContent(
    "Please enter a valid email address."
  );

  expect(authService.register).not.toHaveBeenCalled();
});

test("requires at least six password characters", () => {
  renderRegistration();

  fillForm({
    password: "short",
    confirmPassword: "short",
  });

  submitForm();

  expect(screen.getByRole("alert")).toHaveTextContent(
    "Password must be at least 6 characters."
  );

  expect(authService.register).not.toHaveBeenCalled();
});

test("rejects passwords that do not match", () => {
  renderRegistration();

  fillForm({
    confirmPassword: "different123",
  });

  submitForm();

  expect(screen.getByRole("alert")).toHaveTextContent(
    "Passwords do not match."
  );

  expect(authService.register).not.toHaveBeenCalled();
});

test("calls the existing registration service with trimmed values", async () => {
  authService.register.mockResolvedValue({
    created: true,
  });

  const { onRegister } = renderRegistration();

  fillForm({
    username: "  practiceUser  ",
    email: "  test@example.com  ",
  });

  submitForm();

  await waitFor(() => {
    expect(onRegister).toHaveBeenCalledTimes(1);
  });

  expect(authService.register).toHaveBeenCalledWith({
    username: "practiceUser",
    email: "test@example.com",
    password: "password123",
  });
});

test("shows an existing-email error without navigating", async () => {
  authService.register.mockRejectedValue({
    code: "auth/email-already-in-use",
  });

  const { onRegister } = renderRegistration();

  fillForm();
  submitForm();

  expect(
    await screen.findByRole("alert")
  ).toHaveTextContent(
    "An account with this email already exists."
  );

  expect(onRegister).not.toHaveBeenCalled();
});

test("handles partial account creation errors", async () => {
  authService.register.mockRejectedValue({
    code: "auth/registration-rollback-failed",
  });

  const { onRegister } = renderRegistration();

  fillForm();
  submitForm();

  expect(
    await screen.findByRole("alert")
  ).toHaveTextContent(
    "Your account may have been partially created."
  );

  expect(onRegister).not.toHaveBeenCalled();
});

test("prevents duplicate submissions while pending", async () => {
  let finishRegistration;

  authService.register.mockReturnValue(
    new Promise((resolve) => {
      finishRegistration = resolve;
    })
  );

  const { onRegister, onGoToLogin } =
    renderRegistration();

  fillForm();
  submitForm();

  expect(
    screen.getByRole("button", {
      name: /creating account/i,
    })
  ).toBeDisabled();

  expect(
    screen.getByPlaceholderText("Username")
  ).toBeDisabled();

  expect(
    screen.getByPlaceholderText("Confirm Password")
  ).toBeDisabled();

  expect(
    screen.getByRole("button", {
      name: "Back to Login",
    })
  ).toBeDisabled();

  expect(authService.register).toHaveBeenCalledTimes(1);

  fireEvent.click(
    screen.getByRole("button", {
      name: /creating account/i,
    })
  );

  expect(authService.register).toHaveBeenCalledTimes(1);
  expect(onGoToLogin).not.toHaveBeenCalled();

  finishRegistration({
    created: true,
  });

  await waitFor(() => {
    expect(onRegister).toHaveBeenCalledTimes(1);
  });
});

test("preserves form values after a failed request", async () => {
  authService.register.mockRejectedValue(
    new Error("Unexpected failure")
  );

  const { onRegister } = renderRegistration();

  fillForm();
  submitForm();

  expect(
    await screen.findByRole("alert")
  ).toHaveTextContent(
    "Registration failed. Please try again."
  );

  expect(
    screen.getByPlaceholderText("Username")
  ).toHaveValue("practiceUser");

  expect(
    screen.getByPlaceholderText("Email")
  ).toHaveValue("test@example.com");

  expect(onRegister).not.toHaveBeenCalled();
});
