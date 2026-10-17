
import React from "react";
import BrandLogo from "../common/BrandLogo";

/**
 * Shared visual shell for authentication pages.
 * Registration can reuse this without duplicating the logo/card layout.
 */
function AuthShell({ eyebrow = "YOUR WORKSPACE", title, subtitle, children }) {
  return (
    <div className="ib-auth-page">
      <main className="ib-auth-layout">
        <header className="ib-auth-brand">
          <BrandLogo className="ib-auth-logo" />
          <h1 className="ib-auth-brand-name">Interview Buddy</h1>
          <p className="ib-auth-brand-description">
            Prepare with purpose. Interview with confidence.
          </p>
        </header>

        <section className="ib-card ib-auth-card" aria-labelledby="ib-auth-title">
          <div className="ib-auth-card-header">
            <p className="ib-eyebrow ib-auth-eyebrow">{eyebrow}</p>
            <h2 id="ib-auth-title" className="ib-auth-title">
              {title}
            </h2>
            {subtitle && <p className="ib-auth-subtitle">{subtitle}</p>}
          </div>

          {children}
        </section>

        <p className="ib-auth-footnote">
          Practice coding, theoretical, and quiz-style interviews in one place.
        </p>
      </main>
    </div>
  );
}

export default AuthShell;
