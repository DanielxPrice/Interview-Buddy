import React, { useEffect, useState } from "react";

import PageLayout from "../components/layout/PageLayout";
import SettingsSection from "../components/settings/SettingsSection";

import { userService } from "../services/userService";
import { settingsService } from "../services/settingsService";
import { authService } from "../services/authService";
import { useTheme } from "../context/ThemeContext";

import { useAuth } from "../context/AuthContext";

function SettingsPage({ currentPage, onNavigate }) {
  const { theme, setTheme } = useTheme();

  const { updateProfileCache } = useAuth();

  // Account information
  const [savedUsername, setSavedUsername] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");

  // Request and feedback states
  const [isLoading, setIsLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingTheme, setSavingTheme] = useState(false);

  // Password management
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [status, setStatus] = useState(null);
  

  // Load saved profile and display preferences.
  useEffect(() => {
    let active = true;

    async function loadSettings() {
      try {
        const [profile, savedSettings] = await Promise.all([
          userService.getProfile(),
          settingsService.getSettings(),
        ]);

        if (!active) return;

        const storedUsername = profile?.username || "";

        setSavedUsername(storedUsername);
        setUsername(storedUsername);
        setEmail(profile?.email || "");

        if (
          savedSettings?.theme === "light" ||
          savedSettings?.theme === "dark"
        ) {
          setTheme(
            savedSettings.theme === "dark" ? "Dark" : "Light"
          );
        }
      } catch (error) {
        if (active) {
          setStatus({
            type: "error",
            text: error.message || "Unable to load settings.",
          });
        }
      } finally {
        if (active) setIsLoading(false);
      }
    }

    loadSettings();

    return () => {
      active = false;
    };
  }, [setTheme]);

  // Save username changes through the existing user service.
  async function handleProfileSave(event) {
    event.preventDefault();

    const value = username.trim();

    if (!value) {
      setStatus({
        type: "error",
        text: "Username cannot be empty.",
      });
      return;
    }

    if (value === savedUsername || savingProfile) return;

    setSavingProfile(true);
    setStatus(null);

    try {
      const updatedProfile =
        await userService.updateProfile({ username: value });

      const saved = updatedProfile?.username || value;

      setSavedUsername(saved);
      setUsername(saved);

      updateProfileCache({ username: saved });

      setStatus({
        type: "success",
        text: "Profile changes saved.",
      });
    } catch (error) {
      setStatus({
        type: "error",
        text: error.message || "Unable to save profile.",
      });
    } finally {
      setSavingProfile(false);
    }
  }

  // Persist visual theme through the existing settings service.
  async function handleThemeChange(nextTheme) {
    if (
      isLoading ||
      savingTheme ||
      nextTheme === theme
    ) {
      return;
    }

    setSavingTheme(true);
    setStatus(null);

    try {
      await settingsService.updateSettings({
        theme: nextTheme.toLowerCase(),
      });

      setTheme(nextTheme);

      setStatus({
        type: "success",
        text: "Theme preference saved.",
      });
    } catch (error) {
      setStatus({
        type: "error",
        text: error.message || "Unable to update theme.",
      });
    } finally {
      setSavingTheme(false);
    }
  }


  async function handlePasswordSave(event) {
    event.preventDefault();

    if (isLoading || savingPassword) {
      return;
    }

    if (!currentPassword || !newPassword || !confirmPassword) {
      setStatus({
        type: "error",
        text: "Please complete all password fields.",
      });
      return;
    }

    if (newPassword.length < 6) {
      setStatus({
        type: "error",
        text: "New password must be at least 6 characters long.",
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      setStatus({
        type: "error",
        text: "New passwords do not match.",
      });
      return;
    }

    if (newPassword === currentPassword) {
      setStatus({
        type: "error",
        text: "New password must differ from the current password.",
      });
      return;
    }

    setSavingPassword(true);
    setStatus(null);

    try {
      await authService.changePassword(
        currentPassword,
        newPassword
      );

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");

      setStatus({
        type: "success",
        text: "Password updated successfully.",
      });
    } catch (error) {
      setStatus({
        type: "error",
        text: error.message || "Unable to update password.",
      });
    } finally {
      setSavingPassword(false);
    }
  }

  const profileHasChanges =
    username.trim() !== savedUsername;

  return (
    <PageLayout
      title="Settings"
      subtitle="Manage your account and personalize your Interview Buddy workspace."
      currentPage={currentPage}
      onNavigate={onNavigate}
    >
      <div className="ib-settings-page">

        {/* Success and error messages */}
        {status && (
          <div
            className={`ib-settings-status ib-settings-status--${status.type}`}
            role={status.type === "error" ? "alert" : "status"}
          >
            {status.text}
          </div>
        )}

        {/* Account Settings */}
        <SettingsSection
          id="account-settings-title"
          title="Account Settings"
          description="Your account information and public username."
          icon="user"
        >
          <form onSubmit={handleProfileSave}>
            <div className="ib-settings-grid">
              <div className="ib-settings-field">
                <label
                  className="ib-label"
                  htmlFor="settings-username"
                >
                  Username
                </label>

                <input
                  id="settings-username"
                  className="ib-input"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(event) =>
                    setUsername(event.target.value)
                  }
                  disabled={isLoading || savingProfile}
                  maxLength={60}
                  required
                />
              </div>

              <div className="ib-settings-field">
                <label
                  className="ib-label"
                  htmlFor="settings-email"
                >
                  Email Address
                </label>

                <input
                  id="settings-email"
                  className="ib-input ib-settings-readonly"
                  type="email"
                  value={email}
                  readOnly
                  aria-describedby="settings-email-help"
                />

                <small id="settings-email-help">
                  Email changes aren't currently supported.
                </small>
              </div>
            </div>

            <div className="ib-settings-actions">
              <button
                className="ib-button ib-button--primary"
                type="submit"
                disabled={
                  isLoading ||
                  savingProfile ||
                  !username.trim() ||
                  !profileHasChanges
                }
              >
                {savingProfile
                  ? "Saving..."
                  : "Save Profile Changes"}
              </button>
            </div>
          </form>
        </SettingsSection>

        
        {/* Security and Password - Firebase-backed */}
        <SettingsSection
          id="security-settings-title"
          title="Security & Password"
          description="Manage your account password."
          icon="shield"
        >
          <form
            className="ib-settings-password-form"
            onSubmit={handlePasswordSave}
          >
            <div className="ib-settings-password-grid">
              <div className="ib-settings-field">
                <label
                  className="ib-label"
                  htmlFor="settings-current-password"
                >
                  Current Password
                </label>

                <input
                  id="settings-current-password"
                  className="ib-input"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Enter current password"
                  value={currentPassword}
                  onChange={(event) =>
                    setCurrentPassword(event.target.value)
                  }
                  disabled={isLoading || savingPassword}
                  required
                />
              </div>

              <div className="ib-settings-field">
                <label
                  className="ib-label"
                  htmlFor="settings-new-password"
                >
                  New Password
                </label>

                <input
                  id="settings-new-password"
                  className="ib-input"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Enter new password"
                  value={newPassword}
                  onChange={(event) =>
                    setNewPassword(event.target.value)
                  }
                  disabled={isLoading || savingPassword}
                  minLength={6}
                  required
                />
              </div>

              <div className="ib-settings-field">
                <label
                  className="ib-label"
                  htmlFor="settings-confirm-password"
                >
                  Confirm New Password
                </label>

                <input
                  id="settings-confirm-password"
                  className="ib-input"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Confirm new password"
                  value={confirmPassword}
                  onChange={(event) =>
                    setConfirmPassword(event.target.value)
                  }
                  disabled={isLoading || savingPassword}
                  minLength={6}
                  required
                />
              </div>
            </div>

            <div className="ib-settings-password-footer">
              <p className="ib-settings-password-note">
                Enter your current password to verify your identity.
                New passwords must contain at least 6 characters.
              </p>

              <button
                type="submit"
                className="ib-button ib-button--secondary"
                disabled={isLoading || savingPassword}
              >
                {savingPassword
                  ? "Updating..."
                  : "Update Security"}
              </button>
            </div>
          </form>
        </SettingsSection>

        {/* Display Preferences */}
        <SettingsSection
          id="display-settings-title"
          title="Display Preferences"
          description="Choose how Interview Buddy looks and feels."
          icon="display"
        >
          <div className="ib-settings-preference-row">
            <div>
              <h3>Visual Theme</h3>
              <p>Switch between Light and Dark mode.</p>
            </div>

            <div
              className="ib-settings-segmented"
              role="group"
              aria-label="Visual Theme"
            >
              {["Light", "Dark"].map((option) => (
                <button
                  type="button"
                  key={option}
                  className={
                    theme === option
                      ? "ib-settings-segment is-active"
                      : "ib-settings-segment"
                  }
                  aria-pressed={theme === option}
                  onClick={() =>
                    handleThemeChange(option)
                  }
                  disabled={isLoading || savingTheme}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        </SettingsSection>

        {/* Danger Zone */}
        <SettingsSection
          id="danger-settings-title"
          title="Danger Zone"
          icon="warning"
          danger
        >
          <div className="ib-settings-split-row">
            <p>
              Account deletion has not been connected to
              Firebase yet. This action will be available
              after secure deletion is implemented.
            </p>

            <button
              type="button"
              className="ib-button ib-button--danger"
              disabled
              title="Account deletion is not available yet"
            >
              Delete Account
            </button>
          </div>
        </SettingsSection>

      </div>
    </PageLayout>
  );
}

export default SettingsPage;
