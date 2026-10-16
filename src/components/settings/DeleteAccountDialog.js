
import React, { useEffect, useRef, useState } from "react";
import { accountDeletionService } from "../../services/accountDeletionService";
import "./DeleteAccountDialog.css";

function DeleteAccountDialog({ providerIds = [], onCancel, onDeleted }) {
  const passwordAvailable = providerIds.includes("password");
  const googleAvailable = providerIds.includes("google.com");
  const [method, setMethod] = useState(
    passwordAvailable ? "password" : "google"
  );
  const [confirmation, setConfirmation] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  const submitting = useRef(false);

  useEffect(() => {
    cancelRef.current?.focus();
    function onKeyDown(event) {
      if (event.key === "Escape" && !submitting.current) {
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = Array.from(dialogRef.current?.querySelectorAll(
        'button:not(:disabled),input:not(:disabled)'
      ) || []);
      if (!elements.length) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && document.activeElement === elements[0]) {
        event.preventDefault();
        elements[elements.length - 1].focus();
      } else if (!event.shiftKey &&
        document.activeElement === elements[elements.length - 1]) {
        event.preventDefault();
        elements[0].focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;
    if (confirmation !== "DELETE") {
      setError("Type DELETE to confirm account deletion.");
      return;
    }
    if (method === "password" && !password) {
      setError("Enter your current password.");
      return;
    }
    if ((method === "password" && !passwordAvailable) ||
        (method === "google" && !googleAvailable)) {
      setError("This verification method is not linked to your account.");
      return;
    }

    submitting.current = true;
    setPending(true);
    setError("");
    try {
      await accountDeletionService.deleteAccount({
        confirmation,
        method,
        password: method === "password" ? password : "",
      });
      onDeleted();
    } catch (failure) {
      setError(failure?.message || "Account deletion failed.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <div className="ib-delete-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !submitting.current) onCancel();
    }}>
      <div ref={dialogRef} className="ib-delete-dialog"
        role="dialog" aria-modal="true" aria-labelledby="ib-delete-title"
        aria-describedby="ib-delete-description" aria-busy={pending}>
        <h2 id="ib-delete-title">Delete your account?</h2>
        <p id="ib-delete-description">
          Your account, profile, saved interview sessions, responses and preferences
          will be permanently deleted. This action cannot be undone.
        </p>
        <form onSubmit={submit}>
          <div className="ib-settings-field">
            <label className="ib-label" htmlFor="ib-delete-confirmation">
              Type DELETE to confirm
            </label>
            <input id="ib-delete-confirmation" className="ib-input"
              autoComplete="off" value={confirmation} disabled={pending}
              onChange={(event) => setConfirmation(event.target.value)} required />
          </div>
          {passwordAvailable && googleAvailable && (
            <fieldset className="ib-delete-methods">
              <legend>Verify your identity using</legend>
              <label><input type="radio" name="ib-delete-method"
                checked={method === "password"} disabled={pending}
                onChange={() => { setMethod("password"); setError(""); }} />
                Current password</label>
              <label><input type="radio" name="ib-delete-method"
                checked={method === "google"} disabled={pending}
                onChange={() => { setMethod("google"); setPassword(""); setError(""); }} />
                Google account</label>
            </fieldset>
          )}
          {method === "password" && passwordAvailable && (
            <div className="ib-settings-field ib-delete-password">
              <label className="ib-label" htmlFor="ib-delete-password">
                Current password for deletion
              </label>
              <input id="ib-delete-password" className="ib-input"
                type="password" autoComplete="current-password"
                value={password} disabled={pending} required
                onChange={(event) => setPassword(event.target.value)} />
            </div>
          )}
          {method === "google" && googleAvailable && (
            <p className="ib-delete-note">
              Verify your identity in the Google sign-in popup.
            </p>
          )}
          {error && <p role="alert" className="ib-delete-error">{error}</p>}
          <div className="ib-delete-actions">
            <button ref={cancelRef} type="button"
              className="ib-button ib-button--secondary" disabled={pending}
              onClick={onCancel}>Cancel</button>
            <button type="submit" className="ib-button ib-button--danger"
              disabled={pending || confirmation !== "DELETE" ||
                (method === "password" && !password)}>
              {pending ? "Deleting account..." : "Permanently Delete Account"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default DeleteAccountDialog;
