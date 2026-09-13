import { randomUUID } from "node:crypto";
import type {
  ExtensionUIContext,
  ExtensionUIDialogOptions,
} from "@earendil-works/pi-coding-agent";
import type { Dialog, Notice } from "../shared/types.ts";

export class UiBridge {
  dialogs = new Map<string, Dialog>();
  private pending = new Map<
    string,
    { finish: (value: unknown) => void; reject: (error: Error) => void }
  >();
  statuses: Record<string, string> = {};
  widgets: Record<string, string[]> = {};
  notices: Notice[] = [];
  editorText = "";
  expanded = false;
  private disposed = false;
  constructor(private changed: () => void) {}
  notify(text: string, level: Notice["level"] = "info") {
    if (this.notices.some((x) => x.text === text)) return;
    this.notices = [...this.notices, { id: randomUUID(), text, level }].slice(
      -12,
    );
    this.changed();
  }
  dismiss(id: string) {
    this.notices = this.notices.filter((x) => x.id !== id);
    this.changed();
  }
  request(
    kind: Dialog["kind"],
    title: string,
    extra: Partial<Dialog> = {},
    opts?: ExtensionUIDialogOptions,
  ): Promise<unknown> {
    if (this.disposed)
      return kind === "unsupported"
        ? Promise.reject(new Error("Terminal-only interaction stopped."))
        : Promise.resolve(kind === "confirm" ? false : undefined);
    if (opts?.signal?.aborted)
      return Promise.resolve(kind === "confirm" ? false : undefined);
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        opts?.signal?.removeEventListener("abort", abort);
        this.pending.delete(id);
        this.dialogs.delete(id);
        this.changed();
      };
      const finish = (value: unknown) => {
        cleanup();
        resolve(value);
      };
      const fail = (e: Error) => {
        cleanup();
        reject(e);
      };
      const abort = () =>
        kind === "unsupported"
          ? fail(new Error("Terminal-only interaction stopped."))
          : finish(kind === "confirm" ? false : undefined);
      this.pending.set(id, { finish, reject: fail });
      this.dialogs.set(id, {
        id,
        kind,
        title,
        ...extra,
        ...(opts?.timeout === undefined
          ? {}
          : { expiresAt: Date.now() + opts.timeout }),
      });
      opts?.signal?.addEventListener("abort", abort, { once: true });
      if (opts?.timeout !== undefined)
        timer = setTimeout(abort, Math.max(0, opts.timeout));
      this.changed();
    });
  }
  answer(id: string, value: unknown, cancelled = false) {
    const d = this.dialogs.get(id),
      p = this.pending.get(id);
    if (!d || !p)
      throw new Error(
        "This question was already answered or is no longer active.",
      );
    if (d.kind === "unsupported") {
      p.reject(
        new Error(
          "This extension requires a terminal UI. Add a browser adapter to use it in Margin.",
        ),
      );
      return;
    }
    if (cancelled) {
      p.finish(d.kind === "confirm" ? false : undefined);
      return;
    }
    if (d.kind === "confirm" && typeof value !== "boolean")
      throw new Error("Choose Yes or No.");
    if (d.kind !== "confirm" && typeof value !== "string")
      throw new Error("A text answer is required.");
    if (d.kind === "select" && !d.options?.includes(value as string))
      throw new Error("Choose an available option.");
    p.finish(value);
  }
  cancelAll() {
    for (const [id, d] of this.dialogs) this.answer(id, undefined, true);
  }
  dispose() {
    this.disposed = true;
    this.cancelAll();
  }
  context(): ExtensionUIContext {
    // Extensions may format status strings with a TUI theme. Keep their text, without ANSI.
    const identity = (text: string) => text;
    const theme = {
      name: "browser",
      fg: (_color: unknown, text: string) => text,
      bg: (_color: unknown, text: string) => text,
      bold: identity,
      italic: identity,
      underline: identity,
      inverse: identity,
      strikethrough: identity,
      getFgAnsi: () => "",
      getBgAnsi: () => "",
      getColorMode: () => "truecolor",
      getThinkingBorderColor: () => identity,
      getBashModeBorderColor: () => identity,
    } as unknown as ExtensionUIContext["theme"];
    const unavailable = (name: string) =>
      this.notify(
        `${name} uses a terminal component. Its custom appearance is unavailable here; standard controls remain active.`,
        "warning",
      );
    return {
      select: (title, options, opts) =>
        this.request("select", title, { options }, opts) as Promise<
          string | undefined
        >,
      confirm: (title, message, opts) =>
        this.request("confirm", title, { message }, opts) as Promise<boolean>,
      input: (title, placeholder, opts) =>
        this.request("input", title, { message: placeholder }, opts) as Promise<
          string | undefined
        >,
      editor: (title, prefill) =>
        this.request("editor", title, { prefill }) as Promise<
          string | undefined
        >,
      notify: (message, type) => this.notify(message, type),
      setStatus: (key, text) => {
        if (text === undefined) delete this.statuses[key];
        else this.statuses[key] = text;
        this.changed();
      },
      setWorkingMessage: (text) => {
        if (text) this.statuses.working = text;
        else delete this.statuses.working;
        this.changed();
      },
      setWidget: (key, content) => {
        if (typeof content === "function") {
          unavailable(`Widget ${key}`);
          return;
        }
        if (content) this.widgets[key] = content;
        else delete this.widgets[key];
        this.changed();
      },
      setTitle: (title) => {
        this.statuses.title = title;
        this.changed();
      },
      setEditorText: (text) => {
        this.editorText = text;
        this.changed();
      },
      getEditorText: () => this.editorText,
      pasteToEditor: (text) => {
        this.editorText += text;
        this.changed();
      },
      custom: <T>() =>
        this.request(
          "unsupported",
          "This extension needs a terminal interface",
          {
            message:
              "This interaction cannot be translated automatically. Stop this interaction, then use a browser-capable extension or continue in Pi’s terminal.",
          },
        ) as Promise<T>,
      onTerminalInput: () => {
        unavailable("Raw keyboard input");
        return () => {};
      },
      setFooter: (f) => {
        if (f) unavailable("Custom footer");
      },
      setHeader: (f) => {
        if (f) unavailable("Custom header");
      },
      setEditorComponent: (f) => {
        if (f) unavailable("Custom editor");
      },
      getEditorComponent: () => undefined,
      addAutocompleteProvider: () =>
        unavailable("Custom terminal autocomplete"),
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
      setHiddenThinkingLabel: () => {},
      theme,
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({
        success: false,
        error: "Terminal themes do not apply to the browser.",
      }),
      getToolsExpanded: () => this.expanded,
      setToolsExpanded: (v) => {
        this.expanded = v;
        this.changed();
      },
    };
  }
}
