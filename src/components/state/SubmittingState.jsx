export default function SubmittingState({
  message = "Submitting...",
}) {
  return (
    <div
      className="state submitting ibSubmittingState"
      role="status"
      aria-live="polite"
    >
      <div
        className="ibSubmittingSpinner"
        aria-hidden="true"
      />

      <p>{message}</p>
    </div>
  );
}