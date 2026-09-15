import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ClipboardEvent,
  type RefObject,
} from "react";
import { FileUp, Paperclip, X } from "lucide-react";
import type { Attachment, Snapshot } from "../shared/types.ts";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_DRAFT_ATTACHMENTS,
  attachmentSize,
} from "../shared/attachments.ts";
import { api } from "./api.ts";
import "./Attachments.css";

type AttachmentState = Pick<
  Snapshot,
  "composerAttachments" | "attachmentRevision"
>;
interface Job {
  id: string;
  sessionId: string;
  name: string;
  file?: File;
  status: "uploading" | "removing" | "error";
  error?: string;
}
function base64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onabort = () => reject(new Error("File reading was cancelled."));
    reader.readAsDataURL(file);
  });
}

export function useChatAttachments(
  sessionId: string | null,
  snapshot: Snapshot | null,
  enabled: boolean,
  fail: (error: unknown) => void,
  composerEditor: RefObject<HTMLTextAreaElement | null>,
) {
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const saved = useRef(new Map<string, AttachmentState>());
  const jobs = useRef<Job[]>([]);
  const [, render] = useState(0);
  const queue = useRef(Promise.resolve());
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const update = () => render((n) => n + 1);
  function stateFor(id: string): AttachmentState {
    const live = latest.current?.session.id === id ? latest.current : undefined;
    const stored = saved.current.get(id);
    return (live?.attachmentRevision ?? -1) >=
      (stored?.attachmentRevision ?? -1)
      ? (live ?? {})
      : (stored ?? {});
  }
  function remember(id: string, state: AttachmentState) {
    if (
      (state.attachmentRevision ?? 0) >=
      (saved.current.get(id)?.attachmentRevision ?? 0)
    )
      saved.current.set(id, state);
    update();
  }
  useEffect(() => {
    if (!snapshot) return;
    const id = snapshot.session.id;
    if (
      (snapshot.attachmentRevision ?? 0) >=
      (saved.current.get(id)?.attachmentRevision ?? 0)
    )
      saved.current.set(id, {
        composerAttachments: snapshot.composerAttachments,
        attachmentRevision: snapshot.attachmentRevision,
      });
    const ids = new Set(
      stateFor(id).composerAttachments?.map((file) => file.id),
    );
    // A lost upload response can still be acknowledged by the live snapshot.
    const remaining = jobs.current.filter(
      (job) =>
        !(
          job.sessionId === id &&
          job.status === "error" &&
          job.file &&
          ids.has(job.id)
        ),
    );
    if (remaining.length !== jobs.current.length) {
      jobs.current = remaining;
      update();
    }
  }, [snapshot]);
  useEffect(() => {
    dragDepth.current = 0;
    setDragging(false);
  }, [sessionId, enabled]);
  useEffect(() => {
    const preventNavigation = (event: globalThis.DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    const warn = (event: BeforeUnloadEvent) => {
      if (jobs.current.length) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const reset = () => {
      dragDepth.current = 0;
      setDragging(false);
    };
    window.addEventListener("dragover", preventNavigation);
    window.addEventListener("drop", preventNavigation);
    window.addEventListener("drop", reset);
    window.addEventListener("dragend", reset);
    window.addEventListener("blur", reset);
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("dragover", preventNavigation);
      window.removeEventListener("drop", preventNavigation);
      window.removeEventListener("drop", reset);
      window.removeEventListener("dragend", reset);
      window.removeEventListener("blur", reset);
      window.removeEventListener("beforeunload", warn);
    };
  }, []);
  function finish(id: string) {
    jobs.current = jobs.current.filter((job) => job.id !== id);
    update();
  }
  async function upload(job: Job) {
    if (!jobs.current.includes(job)) return;
    job.status = "uploading";
    job.error = undefined;
    update();
    try {
      const state = await api<AttachmentState>(
        `/sessions/${job.sessionId}/attachments`,
        {
          id: job.id,
          name: job.file!.name,
          mimeType: job.file!.type,
          data: await base64(job.file!),
        },
      );
      if (jobs.current.includes(job)) remember(job.sessionId, state);
      finish(job.id);
    } catch (error) {
      if (!jobs.current.includes(job)) return;
      if (
        stateFor(job.sessionId).composerAttachments?.some(
          (file) => file.id === job.id,
        )
      ) {
        finish(job.id);
        return;
      }
      job.status = "error";
      job.error = error instanceof Error ? error.message : String(error);
      update();
    }
  }
  function add(files: File[]) {
    if (!enabled || !sessionId) {
      fail(
        new Error(
          "Open a Pi chat and finish any pending send before attaching files.",
        ),
      );
      return;
    }
    const id = sessionId;
    let count = new Set([
      ...(stateFor(id).composerAttachments ?? []).map((file) => file.id),
      ...jobs.current
        .filter((job) => job.sessionId === id)
        .map((job) => job.id),
    ]).size;
    let added = false;
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        fail(new Error(`${file.name}: files must be 20 MB or smaller.`));
        continue;
      }
      if (count >= MAX_DRAFT_ATTACHMENTS) {
        fail(new Error("Attach at most 10 files per message."));
        break;
      }
      const job: Job = {
        id: crypto.randomUUID(),
        sessionId: id,
        name: file.name,
        file,
        status: "uploading",
      };
      jobs.current.push(job);
      added = true;
      count++;
      // Bound memory use; a navigation never changes a queued upload's destination.
      queue.current = queue.current.then(() => upload(job));
    }
    update();
    // Focus during the explicit attachment gesture (also opens mobile keyboards),
    // not an async completion that could steal focus after typing or navigation.
    if (added) composerEditor.current?.focus({ preventScroll: true });
  }
  async function remove(id: string) {
    if (!enabled || !sessionId) return;
    const destination = sessionId;
    let job = jobs.current.find((job) => job.id === id);
    if (job && job.status !== "error") return;
    if (!job) {
      const file = stateFor(destination).composerAttachments?.find(
        (file) => file.id === id,
      );
      if (!file) return;
      job = { id, sessionId: destination, name: file.name, status: "removing" };
      jobs.current.push(job);
    }
    job.status = "removing";
    job.file = undefined;
    update();
    try {
      remember(
        destination,
        await api<AttachmentState>(
          `/sessions/${destination}/attachments/${id}`,
          {},
          "DELETE",
        ),
      );
      finish(id);
    } catch (error) {
      job.status = "error";
      job.error = error instanceof Error ? error.message : String(error);
      update();
    }
  }
  const files = sessionId
    ? (stateFor(sessionId).composerAttachments ?? [])
    : [];
  const currentJobs = jobs.current.filter((job) => job.sessionId === sessionId);
  const fileDrag = (event: DragEvent) =>
    event.dataTransfer.types.includes("Files");
  return {
    files,
    forgetSession(id: string) {
      jobs.current = jobs.current.filter((job) => job.sessionId !== id);
      saved.current.delete(id);
      update();
    },
    pending: currentJobs.length > 0,
    hasPending: (id: string) =>
      jobs.current.some((job) => job.sessionId === id),
    ids: (id: string) =>
      (stateFor(id).composerAttachments ?? []).map((file) => file.id),
    dropProps: {
      onDragEnter(event: DragEvent) {
        if (!fileDrag(event)) return;
        event.preventDefault();
        if (enabled && ++dragDepth.current > 0) setDragging(true);
      },
      onDragOver(event: DragEvent) {
        if (!fileDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = enabled ? "copy" : "none";
      },
      onDragLeave(event: DragEvent) {
        if (!fileDrag(event)) return;
        if (--dragDepth.current <= 0) {
          dragDepth.current = 0;
          setDragging(false);
        }
      },
      onDrop(event: DragEvent) {
        if (!fileDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        dragDepth.current = 0;
        setDragging(false);
        const files = [...event.dataTransfer.files];
        const directory = [...event.dataTransfer.items].some(
          (item) => item.webkitGetAsEntry?.()?.isDirectory,
        );
        if (directory)
          fail(new Error("Attach individual files, or zip a folder first."));
        else add(files);
      },
    },
    paste(event: ClipboardEvent<HTMLTextAreaElement>) {
      const files = [...event.clipboardData.files];
      if (!files.length) return;
      if (!event.clipboardData.getData("text/plain")) event.preventDefault();
      add(files);
    },
    overlay: dragging && (
      <div className="attachment-drop-overlay" role="status">
        <FileUp size={32} />
        <strong>Attach to this conversation</strong>
        <span>Any file · up to 20 MB each</span>
      </div>
    ),
    button: (
      <>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          aria-label="Choose attachments"
          onChange={(event) => {
            add([...(event.target.files ?? [])]);
            event.target.value = "";
          }}
        />
        <button
          type="button"
          aria-label="Attach files"
          title="Attach files (up to 20 MB each)"
          disabled={!enabled}
          onClick={() => input.current?.click()}
        >
          <Paperclip size={16} />
        </button>
      </>
    ),
    chips: (files.length > 0 || currentJobs.length > 0) && (
      <div className="attachment-drafts" aria-label="Draft attachments">
        {files
          .filter((file) => !currentJobs.some((job) => job.id === file.id))
          .map((file) => (
            <div
              className="attachment-chip"
              key={file.id}
              title={`${file.name} · ${attachmentSize(file.size)}`}
            >
              <Paperclip size={14} />
              <span className="attachment-name">{file.name}</span>
              <button
                type="button"
                disabled={!enabled}
                aria-label={`Remove ${file.name}`}
                onClick={() => void remove(file.id)}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        {currentJobs.map((job) => (
          <div
            className={`attachment-chip ${job.status === "error" ? "failed" : ""}`}
            key={job.id}
            title={`${job.name}${job.file ? ` · ${attachmentSize(job.file.size)}` : ""}`}
          >
            <Paperclip size={14} />
            <span>
              <span className="attachment-name">{job.name}</span>
              <small role={job.status === "error" ? "alert" : "status"}>
                {job.status === "error"
                  ? job.error
                  : job.status === "removing"
                    ? "Removing…"
                    : "Uploading…"}
              </small>
            </span>
            {job.status === "error" && (
              <>
                {job.file && (
                  <button
                    type="button"
                    disabled={!enabled}
                    onClick={() => {
                      job.status = "uploading";
                      update();
                      queue.current = queue.current.then(() => upload(job));
                      composerEditor.current?.focus({ preventScroll: true });
                    }}
                  >
                    Retry
                  </button>
                )}
                <button
                  type="button"
                  disabled={!enabled}
                  aria-label={`Remove ${job.name}`}
                  onClick={() => void remove(job.id)}
                >
                  <X size={14} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    ),
  };
}

export function SentAttachments({
  sessionId,
  files,
}: {
  sessionId: string;
  files?: Attachment[];
}) {
  if (!files?.length) return null;
  return (
    <div className="sent-attachments" aria-label="Sent attachments">
      {files.map((file) => (
        <a
          className="attachment-chip"
          key={file.id}
          href={`/api/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(file.id)}/download`}
          download={file.name}
          aria-label={`Download ${file.name}`}
          title={`Download ${file.name} · ${attachmentSize(file.size)}`}
        >
          <Paperclip size={14} />
          <span className="attachment-name">{file.name}</span>
        </a>
      ))}
    </div>
  );
}
