import type { ServerResponse } from "node:http";

/** Lossy transport, not lossy history: keep only the newest unsent snapshot.
 * Never let a slow browser apply backpressure to the agent itself.
 */
export function snapshotStream<T>(
  response: ServerResponse,
  options: {
    serialize: (snapshot: T) => string;
    onClose: () => void;
    onStall?: (queuedBytes: number) => void;
    stallMs?: number;
  },
) {
  let blocked = false,
    closed = false,
    pending: { value: T } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const close = () => {
    if (closed) return;
    closed = true;
    pending = undefined;
    if (timer) clearTimeout(timer);
    response.off("drain", drain);
    response.off("close", close);
    response.off("error", fail);
    options.onClose();
  };
  const fail = () => {
    close();
    response.destroy();
  };
  const write = (text: string) => {
    if (closed) return;
    try {
      if (!response.write(text)) {
        blocked = true;
        timer = setTimeout(() => {
          try {
            options.onStall?.(response.writableLength);
          } finally {
            fail();
          }
        }, options.stallMs ?? 30_000);
        timer.unref?.();
      }
    } catch {
      fail();
    }
  };
  const send = (value: T) => {
    if (closed) return;
    if (blocked) {
      pending = { value };
      return;
    }
    try {
      write(options.serialize(value));
    } catch {
      fail();
    }
  };
  const drain = () => {
    if (closed) return;
    blocked = false;
    if (timer) clearTimeout(timer);
    timer = undefined;
    const latest = pending;
    pending = undefined;
    if (latest) send(latest.value);
  };
  response.on("drain", drain);
  response.once("close", close);
  response.once("error", fail);
  return {
    send,
    heartbeat: () => {
      if (!blocked) write(": keepalive\n\n");
    },
    close,
  };
}
