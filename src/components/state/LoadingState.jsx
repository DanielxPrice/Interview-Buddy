export default function LoadingState({
  title,
  message = "Loading...",
}) {
  return (
    <div
      className="state loading ibStateCard ib-card"
      role="status"
      aria-live="polite"
    >
      <div
        className="ibStateSpinner"
        aria-hidden="true"
      />

      <div className="ibStateContent">
        {title && <h2>{title}</h2>}
        <p>{message}</p>
      </div>
    </div>
  );
}