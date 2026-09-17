import { useRef, useState } from "react";
import { submitOnEnter } from "./submit-on-enter.ts";
import { CircleHelp, AlertTriangle } from "lucide-react";
import type { Dialog } from "../shared/types.ts";
export function DialogCard({
  dialog,
  onAnswer,
}: {
  dialog: Dialog;
  onAnswer: (id: string, value: unknown, cancelled?: boolean) => Promise<void>;
}) {
  const [text, setText] = useState(dialog.prefill ?? ""),
    [sending, setSending] = useState(false),
    [error, setError] = useState("");
  const pending = useRef(false);
  const answer = async (value: unknown, cancelled = false) => {
    if (pending.current) return;
    pending.current = true;
    setSending(true);
    try {
      await onAnswer(dialog.id, value, cancelled);
    } catch (e) {
      setError((e as Error).message);
      pending.current = false;
      setSending(false);
    }
  };
  return (
    <section className="question-card" aria-label={dialog.title}>
      <div className="question-label">
        {dialog.kind === "unsupported" ? (
          <AlertTriangle size={15} />
        ) : (
          <CircleHelp size={15} />
        )}{" "}
        {dialog.kind === "unsupported"
          ? "Extension compatibility"
          : "Waiting for your answer"}
      </div>
      <h3>{dialog.title}</h3>
      {dialog.message && <p>{dialog.message}</p>}
      {dialog.expiresAt && (
        <p className="muted small">
          Expires at {new Date(dialog.expiresAt).toLocaleTimeString()}
        </p>
      )}
      {dialog.kind === "select" && (
        <div className="question-options">
          {dialog.options?.map((o) => (
            <button key={o} disabled={sending} onClick={() => void answer(o)}>
              {o}
            </button>
          ))}
        </div>
      )}
      {dialog.kind === "confirm" && (
        <div className="question-options">
          <button
            className="primary"
            disabled={sending}
            onClick={() => void answer(true)}
          >
            Yes
          </button>
          <button disabled={sending} onClick={() => void answer(false)}>
            No
          </button>
        </div>
      )}
      {(dialog.kind === "input" || dialog.kind === "editor") && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void answer(text);
          }}
        >
          <textarea
            aria-label={dialog.title}
            rows={dialog.kind === "editor" ? 5 : 2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={dialog.kind === "input"
              ? (e) => submitOnEnter(e, () => void answer(text))
              : undefined}
            autoFocus
          />
          <button
            className="primary"
            disabled={sending}
            type="submit"
            title={dialog.kind === "input" ? "Submit answer (Enter); Shift+Enter for a new line" : undefined}
            aria-keyshortcuts={dialog.kind === "input" ? "Enter" : undefined}
          >
            Submit answer
          </button>
        </form>
      )}
      {dialog.kind === "unsupported" ? (
        <button disabled={sending} onClick={() => void answer(undefined, true)}>
          Stop this interaction
        </button>
      ) : (
        <button
          className="muted small"
          disabled={sending}
          onClick={() => void answer(undefined, true)}
        >
          Cancel question
        </button>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </section>
  );
}
