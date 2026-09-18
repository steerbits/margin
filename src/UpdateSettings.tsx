import {
  marginRepository,
  releaseNotesUrl,
  updateAvailable,
  type UpdateStatus,
} from "../shared/updates.ts";
export function UpdateSettings({
  status,
  checking,
  onCheck,
  onReview,
}: {
  status: UpdateStatus | null;
  checking: boolean;
  onCheck: () => void;
  onReview: () => void;
}) {
  const latest = status?.manifest?.latest;
  return (
    <section
      className="update-settings"
      aria-labelledby="margin-updates-heading"
    >
      <h3 id="margin-updates-heading">Margin updates</h3>
      <p>
        Running:{" "}
        <strong>{status?.runningVersion ?? "Version not identified"}</strong>
        <br />
        Latest published: <strong>{latest?.version ?? "Not available"}</strong>
      </p>
      {status?.identityWarning && <p>{status.identityWarning}</p>}
      {status?.error && <p role="status">{status.error}</p>}
      {!status?.error &&
        latest &&
        status?.runningVersion &&
        !updateAvailable(status) && <p>No newer published version.</p>}
      {status?.manifest && !latest && <p>No release has been published yet.</p>}
      {status?.checkedAt && (
        <p className="settings-help">
          Last checked: {new Date(status.checkedAt).toLocaleString()}
        </p>
      )}
      {latest?.tests.status === "skipped" && (
        <p>Publisher skipped release tests: {latest.tests.reason}</p>
      )}
      <div className="update-actions">
        <button type="button" disabled={checking} onClick={onCheck}>
          {checking ? "Checking…" : "Check for updates"}
        </button>
        {latest && (updateAvailable(status) || !status?.runningVersion) && (
          <button type="button" onClick={onReview}>
            Review update
          </button>
        )}
        <a
          href={latest ? releaseNotesUrl(latest) : marginRepository}
          target="_blank"
          rel="noopener noreferrer"
        >
          {latest ? "Release notes" : "Official repository"}
        </a>
      </div>
      <p className="settings-help">
        Only highlighted releases appear in the header. Reviewing starts an AI
        chat when connected; installation needs your confirmation.
      </p>
    </section>
  );
}
