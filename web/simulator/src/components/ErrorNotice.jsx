export default function ErrorNotice({ error }) {
  if (!error) return null;
  return (
    <div className="error-notice" role="alert">
      <strong>{error.message}</strong>
      {error.issues?.length > 0 && (
        <ul>{error.issues.map((issue, index) => <li key={`${issue.field ?? issue}-${index}`}>{issue.message ?? issue}</li>)}</ul>
      )}
    </div>
  );
}
