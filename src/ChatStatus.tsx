import type { SessionActivity } from "../shared/types.ts";
const labels = {
  idle: "Ready",
  running: "Running",
  waiting: "Waiting for you",
  finished: "Finished",
  failed: "Failed",
  stopped: "Stopped",
};
export function ChatStatus({
  activity,
  unread = false,
}: {
  activity?: SessionActivity;
  unread?: boolean;
}) {
  const status = activity?.status ?? "idle";
  const label = `${labels[status]}${unread ? " · Unread" : ""}`;
  return (
    <span
      className={`chat-status ${status} ${unread ? "unread" : ""}`}
      role="status"
      aria-label={label}
      title={label}
    >
      <i aria-hidden="true" />
      {label}
    </span>
  );
}
