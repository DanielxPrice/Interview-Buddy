export default function EmptyState({
  title="No results",
  description
}) {
  return (
    <div className="state empty">
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}