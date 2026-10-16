
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import DeleteAccountDialog from "./DeleteAccountDialog";
import { accountDeletionService } from "../../services/accountDeletionService";

jest.mock("../../services/accountDeletionService", () => ({
  accountDeletionService: { deleteAccount: jest.fn() },
}));

beforeEach(() => {
  jest.clearAllMocks();
  accountDeletionService.deleteAccount.mockResolvedValue({ deleted: true });
});

function show(providers = ["password", "google.com"], callbacks = {}) {
  const onCancel = callbacks.onCancel || jest.fn();
  const onDeleted = callbacks.onDeleted || jest.fn();
  render(<DeleteAccountDialog providerIds={providers}
    onCancel={onCancel} onDeleted={onDeleted} />);
  return { onCancel, onDeleted };
}

function enterConfirmation() {
  fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), {
    target: { value: "DELETE" },
  });
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Permanently Delete Account" }));
}

test("Cancel closes without deleting", () => {
  const { onCancel } = show();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(accountDeletionService.deleteAccount).not.toHaveBeenCalled();
});

test("requires exact DELETE and password", () => {
  show();
  const button = screen.getByRole("button", { name: "Permanently Delete Account" });
  expect(button).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), {
    target: { value: "delete" },
  });
  expect(button).toBeDisabled();
  enterConfirmation();
  expect(button).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Current password for deletion"), {
    target: { value: "my-password" },
  });
  expect(button).toBeEnabled();
});

test("password verification invokes deletion service and completion callback", async () => {
  const { onDeleted } = show(["password"]);
  enterConfirmation();
  fireEvent.change(screen.getByLabelText("Current password for deletion"), {
    target: { value: "my-password" },
  });
  submit();
  await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
  expect(accountDeletionService.deleteAccount).toHaveBeenCalledWith({
    confirmation: "DELETE", method: "password", password: "my-password",
  });
});

test("Google-only account does not ask for a password", async () => {
  const { onDeleted } = show(["google.com"]);
  enterConfirmation();
  expect(screen.queryByLabelText("Current password for deletion")).not.toBeInTheDocument();
  submit();
  await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
  expect(accountDeletionService.deleteAccount).toHaveBeenCalledWith({
    confirmation: "DELETE", method: "google", password: "",
  });
});

test("failure stays in dialog without navigating", async () => {
  accountDeletionService.deleteAccount.mockRejectedValue(new Error("Wrong password"));
  const { onDeleted } = show();
  enterConfirmation();
  fireEvent.change(screen.getByLabelText("Current password for deletion"), {
    target: { value: "wrong" },
  });
  submit();
  expect(await screen.findByRole("alert")).toHaveTextContent("Wrong password");
  expect(onDeleted).not.toHaveBeenCalled();
});

test("pending deletion disables Cancel and prevents duplicate submits", async () => {
  let resolveDeletion;
  accountDeletionService.deleteAccount.mockReturnValue(
    new Promise((resolve) => { resolveDeletion = resolve; })
  );
  const { onDeleted } = show(["password"]);
  enterConfirmation();
  fireEvent.change(screen.getByLabelText("Current password for deletion"), {
    target: { value: "my-password" },
  });
  submit();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(accountDeletionService.deleteAccount).toHaveBeenCalledTimes(1);
  await act(async () => resolveDeletion({ deleted: true }));
  expect(onDeleted).toHaveBeenCalledTimes(1);
});
