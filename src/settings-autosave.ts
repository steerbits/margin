import type { MarginSettings } from "../shared/settings.ts";

const equal = (a: MarginSettings, b: MarginSettings) =>
  JSON.stringify(a) === JSON.stringify(b);
export class SettingsAutosave {
  draft: MarginSettings;
  saved: MarginSettings;
  error = "";
  private uncertain = false;
  private running?: Promise<void>;
  constructor(
    initial: MarginSettings,
    private write: (value: MarginSettings) => Promise<void>,
    private changed: () => void,
  ) {
    this.draft = structuredClone(initial);
    this.saved = structuredClone(initial);
  }
  get dirty() {
    return this.uncertain || !equal(this.draft, this.saved);
  }
  get saving() {
    return !!this.running;
  }
  update(value: MarginSettings) {
    this.draft = structuredClone(value);
    this.error = "";
    this.start();
    this.changed();
  }
  retry() {
    this.error = "";
    this.start();
    this.changed();
  }
  private start() {
    if (this.running || !this.dirty) return;
    this.running = Promise.resolve()
      .then(async () => {
        while (this.dirty) {
          const requested = structuredClone(this.draft);
          try {
            await this.write(requested);
            this.saved = requested;
            this.uncertain = false;
          } catch (error) {
            this.uncertain = true;
            this.error =
              error instanceof Error
                ? error.message
                : "Unable to save settings.";
            break;
          }
        }
      })
      .finally(() => {
        this.running = undefined;
        this.changed();
      });
  }
  async flush() {
    await this.running;
    return !this.dirty;
  }
}
