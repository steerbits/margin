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
  agent,
}: {
  activity?: SessionActivity;
  unread?: boolean;
  agent?: string;
}) {
  const status = activity?.status ?? "idle";
  const label = `${labels[status]}${unread ? " · Unread" : ""}`;
  return (
    <span
      className={`chat-status ${status} ${unread ? "unread" : ""}`}
      role={agent ? "status" : undefined}
      aria-label={`${agent ? `${agent}: ` : ""}${label}`}
      title={label}
    >
      <i aria-hidden="true" />
      {label}
    </span>
  );
}
