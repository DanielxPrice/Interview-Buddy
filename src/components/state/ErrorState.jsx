export default function ErrorState({
  title,
  message = "Something went wrong",
  retry,
  retryLabel = "Try Again",
}) {
  return (
    <div
      className="state error ibStateCard ibStateCard--error ib-card"
      role="alert"
    >
      <div
        className="ibStateIcon"
        aria-hidden="true"
      >
        !
      </div>

      <div className="ibStateContent">
        {title && <h2>{title}</h2>}
        <p>{message}</p>
      </div>

      {retry && (
        <button
          type="button"
          className="ib-button ib-button--primary"
          onClick={retry}
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}