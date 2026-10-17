import React from "react";

function PracticeModeCard({
  icon,
  title,
  description,
  buttonLabel,
  onOpen,
}) {
  return (
    <article className="practiceModeCard">
      <div
        className="practiceModeIcon"
        aria-hidden="true"
      >
        {icon}
      </div>

      <div className="practiceModeContent">
        <h2 className="practiceModeTitle">
          {title}
        </h2>

        <p className="practiceModeDescription">
          {description}
        </p>
      </div>

      <button
        type="button"
        className="ib-button ib-button--primary practiceModeButton"
        onClick={onOpen}
      >
        {buttonLabel}

        <span
          className="practiceModeButtonArrow"
          aria-hidden="true"
        >
          →
        </span>
      </button>
    </article>
  );
}

export default PracticeModeCard;