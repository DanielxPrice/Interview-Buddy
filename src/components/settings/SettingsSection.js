
import React from "react";

/**
 * Reusable, accessible card heading for the Settings screen.
 * Uses the same ib-card surface as the redesigned Dashboard.
 */
function SettingsSection({
  id,
  title,
  description,
  icon = "user",
  danger = false,
  children,
}) {
  const icons = {
    user: (
      <>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5.5 20v-1.5a6.5 6.5 0 0 1 13 0V20" />
      </>
    ),
    shield: (
      <>
        <path d="m12 2 8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
    display: (
      <>
        <rect x="3" y="4" width="18" height="14" rx="2" />
        <path d="M8 22h8M12 18v4" />
      </>
    ),
    warning: (
      <>
        <path d="m12 3 10 18H2z" />
        <path d="M12 9v5M12 18h.01" />
      </>
    ),
  };

  return (
    <section
      className={`ib-card ib-settings-section${
        danger ? " ib-settings-section--danger" : ""
      }`}
      aria-labelledby={id}
    >
      <header className="ib-settings-section-header">
        <span className="ib-settings-section-icon" aria-hidden="true">
          <svg
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {icons[icon] || icons.user}
          </svg>
        </span>

        <div>
          <h2 id={id}>{title}</h2>
          {description && <p>{description}</p>}
        </div>
      </header>

      <div className="ib-settings-section-body">
        {children}
      </div>
    </section>
  );
}

export default SettingsSection;
