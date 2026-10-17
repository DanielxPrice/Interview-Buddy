import React from "react";

function FeedbackBox({ feedbackType, feedbackMessage }) {
  if (!feedbackMessage) return null;

  return (
    <div className={`quizFeedback ${feedbackType}`}>
      <p style={{ whiteSpace: "pre-line" }}>{feedbackMessage}</p>
    </div>
  );
}

export default FeedbackBox;