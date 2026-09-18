import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Express } from "express";
import {
  compareVersions,
  marginReleaseFeed,
  marginReleaseFeedFallback,
  parseReleaseManifest,
  validVersion,
  type ReleaseManifest,
  type UpdateStatus,
} from "../shared/updates.ts";

const interval = 6 * 60 * 60 * 1000;
const cooldown = 60_000;
const maxBytes = 32 * 1024;
interface Cache {
  manifest: ReleaseManifest | null;
  checkedAt: number | null;
  attemptedAt: number;
  nextCheck: number;
  etag?: string;
  etagSource?: string;
  retryUntil?: number;
  error?: string;
}
/** Captured once at host startup, never re-read when source or dist is edited. */
export function runningIdentity(
  root: string,
  production: boolean,
): Pick<UpdateStatus, "runningVersion" | "runningCommit" | "identityWarning"> {
  try {
    const source = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    if (!validVersion(source.version)) throw new Error();
    if (!production)
      return {
        runningVersion: source.version,
        runningCommit: null,
        identityWarning:
          "Development source version captured at startup; restart after backend changes.",
      };
    const build = JSON.parse(
      readFileSync(join(root, "dist/margin-build.json"), "utf8"),
    );
    if (!validVersion(build.version)) throw new Error();
    return {
      runningVersion: build.version,
      runningCommit:
        typeof build.commit === "string" && /^[a-f0-9]{40}$/.test(build.commit)
          ? build.commit
          : null,
      ...(build.version !== source.version
        ? {
            identityWarning:
              `Source is v${source.version}; the built app is v${build.version}. ` +
              "Restart Margin, then refresh, to finish applying the source changes.",
          }
        : {}),
    };
  } catch {
    return {
      runningVersion: null,
      runningCommit: null,
      identityWarning:
        "Running version not identified: source and build may differ. Rebuild, restart Margin, and refresh.",
    };
  }
}

export class UpdateChecker {
  private cache: Cache = {
    manifest: null,
    checkedAt: null,
    attemptedAt: 0,
    nextCheck: 0,
  };
  private error?: string;
  private pending?: Promise<void>;
  private initialized: Promise<void>;
  private failures = 0;
  constructor(
    private options: {
      dataDir: string;
      identity: ReturnType<typeof runningIdentity>;
      fetch?: typeof fetch;
      now?: () => number;
      disabled?: boolean;
    },
  ) {
    this.initialized = this.load();
  }
  private now() {
    return (this.options.now ?? Date.now)();
  }
  private get file() {
    return join(this.options.dataDir, "updates/cache.json");
  }
  private async load() {
    try {
      const raw = await readFile(this.file, "utf8");
      if (Buffer.byteLength(raw) > maxBytes) return;
      const c = JSON.parse(raw) as Cache;
      const now = this.now();
      if (c.manifest !== null) c.manifest = parseReleaseManifest(c.manifest);
      if (
        !(
          c.checkedAt === null ||
          (Number.isFinite(c.checkedAt) &&
            c.checkedAt >= 0 &&
            c.checkedAt <= now)
        ) ||
        !Number.isFinite(c.attemptedAt) ||
        c.attemptedAt < 0 ||
        c.attemptedAt > now ||
        !Number.isFinite(c.nextCheck) ||
        c.nextCheck > now + 86400000 ||
        (c.etag !== undefined &&
          (typeof c.etag !== "string" || c.etag.length > 500)) ||
        (c.etagSource !== undefined &&
          c.etagSource !== marginReleaseFeed &&
          c.etagSource !== marginReleaseFeedFallback) ||
        (c.retryUntil !== undefined &&
          (!Number.isFinite(c.retryUntil) || c.retryUntil > now + 86400000)) ||
        (c.error !== undefined &&
          (typeof c.error !== "string" || c.error.length > 300))
      )
        return;
      this.cache = c;
      this.error = c.error;
    } catch {
      /* Missing or damaged cache must not prevent startup. */
    }
  }
  async ready() {
    await this.initialized;
    return this.status();
  }
  status(): UpdateStatus {
    return {
      ...this.options.identity,
      manifest: this.cache.manifest,
      checkedAt: this.cache.checkedAt,
      ...(this.error ? { error: this.error } : {}),
    };
  }
  check(force = false): Promise<void> {
    if (this.pending) return this.pending;
    this.pending = this.perform(force).finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }
  private async fetchFeed() {
    const request = async (source: string, accept: string) => {
      // Older caches contain validators for the raw feed only. Never send a
      // validator to a different endpoint, even when both serve the same file.
      const etag =
        this.cache.manifest &&
        (this.cache.etagSource ?? marginReleaseFeed) === source
          ? this.cache.etag
          : undefined;
      const response = await (this.options.fetch ?? fetch)(source, {
        signal: AbortSignal.timeout(8000),
        redirect: "error",
        headers: {
          Accept: accept,
          ...(etag ? { "If-None-Match": etag } : {}),
        },
      });
      return { response, source, etag };
    };
    try {
      return await request(marginReleaseFeed, "application/json");
    } catch {
      // A raw-content edge can stall during TLS while GitHub's API is healthy.
      // Only connection failures trigger fallback; HTTP errors and invalid
      // manifests still follow the normal validation and retry policy.
      return request(
        marginReleaseFeedFallback,
        "application/vnd.github.raw+json",
      );
    }
  }
  private async perform(force: boolean) {
    await this.initialized;
    if (this.options.disabled) return;
    const now = this.now();
    if (this.cache.attemptedAt && now - this.cache.attemptedAt < cooldown)
      return;
    if (now < (this.cache.retryUntil ?? 0)) return;
    if (!force && now < this.cache.nextCheck) return;
    this.cache.attemptedAt = now;
    let retryAfter = 0;
    try {
      const { response, source, etag: requestedEtag } = await this.fetchFeed();
      const retry = response.headers.get("retry-after");
      if (retry)
        retryAfter = Math.min(
          86400000,
          Math.max(
            0,
            /^\d+$/.test(retry)
              ? Number(retry) * 1000
              : Date.parse(retry) - now,
          ),
        );
      if (response.status === 304 && this.cache.manifest && requestedEtag) {
        await response.body?.cancel();
      } else {
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(
            response.status === 404
              ? "No published release feed yet."
              : "Couldn't check for updates. Try again later.",
          );
        }
        if (Number(response.headers.get("content-length")) > maxBytes) {
          await response.body?.cancel();
          throw new Error("Release feed is too large.");
        }
        const reader = response.body?.getReader();
        if (!reader) throw new Error("Empty release feed.");
        const chunks: Uint8Array[] = [];
        let length = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.length;
            if (length > maxBytes)
              throw new Error("Release feed is too large.");
            chunks.push(value);
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
        const manifest = parseReleaseManifest(
          JSON.parse(Buffer.concat(chunks).toString("utf8")),
        );
        const previous = this.cache.manifest?.latest,
          next = manifest.latest;
        if (
          previous &&
          (!next ||
            compareVersions(next.version, previous.version) < 0 ||
            (next.version === previous.version &&
              next.commit !== previous.commit))
        )
          throw new Error(
            "Published release identity changed or moved backwards. Review the official repository.",
          );
        const highlighted = this.cache.manifest?.lastHighlightedVersion;
        if (
          highlighted &&
          (!manifest.lastHighlightedVersion ||
            compareVersions(manifest.lastHighlightedVersion, highlighted) < 0)
        )
          throw new Error(
            "Published notification history moved backwards. Review the official repository.",
          );
        this.cache.manifest = manifest;
        const etag = response.headers.get("etag");
        this.cache.etag = etag && etag.length <= 500 ? etag : undefined;
        this.cache.etagSource = source;
      }
      this.cache.checkedAt = now;
      this.cache.nextCheck =
        now + interval + Math.floor(Math.random() * 60_000);
      this.failures = 0;
      this.cache.retryUntil = undefined;
      this.error = undefined;
    } catch (error) {
      this.failures++;
      this.error =
        error instanceof Error &&
        /^(No published|Release feed|Published)/.test(error.message)
          ? error.message
          : "Couldn't check for updates. Cached information may be out of date.";
      this.cache.retryUntil = now + (retryAfter || 0);
      this.cache.nextCheck =
        now +
        Math.max(
          retryAfter || 0,
          Math.min(interval, 600_000 * 2 ** Math.min(this.failures - 1, 6)),
        );
    }
    this.cache.error = this.error;
    try {
      await mkdir(join(this.options.dataDir, "updates"), { recursive: true });
      await writeFile(`${this.file}.tmp`, JSON.stringify(this.cache) + "\n", {
        mode: 0o600,
      });
      await rename(`${this.file}.tmp`, this.file);
    } catch {
      /* In-memory checking still works if private cache cannot be saved. */
    }
  }
}

/** Only the gateway (or standalone host), never a workspace worker, owns discovery. */
export function installUpdateRoutes(
  app: Express,
  root: string,
  dataDir: string,
) {
  const checker = new UpdateChecker({
    dataDir,
    identity: runningIdentity(root, process.env.NODE_ENV === "production"),
    disabled: process.env.MARGIN_TEST_MODE === "1",
  });
  void checker.check();
  const timer = setInterval(() => void checker.check(), 60_000);
  timer.unref();
  app.get("/api/updates", async (_req, res) => {
    await checker.ready();
    void checker.check();
    res.json(checker.status());
  });
  app.post("/api/updates/check", async (_req, res) => {
    await checker.check(true);
    res.json(checker.status());
  });
  return checker;
}
