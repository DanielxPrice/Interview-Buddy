
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
  emptyTitle = "No results",
  emptyDescription,
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

  //Backwards compatible change, existing components wont need to be updated for custom empty states
  if (empty && data.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
      />
    );
  }

  return children;
}

export default StateRenderer;
