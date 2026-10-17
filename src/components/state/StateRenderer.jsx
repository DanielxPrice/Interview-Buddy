import EmptyState from "./EmptyState";
import ErrorState from "./ErrorState";
import LoadingState from "./LoadingState";
import SubmittingState from "./SubmittingState";

function StateRenderer({
  status,
  data = [],
  error,
  children,
  empty,
}) {
  if (status === "submitting") {
    return <SubmittingState />;
  }

  if (status === "loading") {
    return <LoadingState />;
  }

  if (status === "error") {
    return <ErrorState message={error} />;
  }

  if (empty && data.length === 0) {
    return <EmptyState />;
  }

  return children;
}

export default StateRenderer;