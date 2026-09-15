import { randomUUID } from "node:crypto";
import type { Express, RequestHandler } from "express";
import { z } from "zod";
import {
  CredentialSynchronizationError,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type { AuthEvent, AuthPrompt, AuthType } from "@earendil-works/pi-ai";
import {
  safeAuthUrl,
  type ProviderAccount,
  type ProviderAccountsView,
  type ProviderLogin,
} from "../shared/provider-accounts.ts";

export type AccountRuntime = Pick<
  ModelRuntime,
  "getProviders" | "checkAuth" | "listCredentials" | "login" | "logout"
>;
class AccountError extends Error {}
interface LoginAttempt {
  view: ProviderLogin;
  abort: AbortController;
  running: boolean;
  reason?: "cancelled" | "expired";
  answer?: (value: string) => void;
}
const names: Record<string, string> = {
  "openai-codex": "ChatGPT / Codex",
  anthropic: "Anthropic (Claude)",
  xai: "xAI (Grok)",
  google: "Google (Gemini)",
};
const featured = [
  "openai-codex",
  "anthropic",
  "xai",
  "github-copilot",
  "google",
  "openrouter",
];

// One bounded, in-memory interaction per local Margin installation. Pi owns
// OAuth/PKCE, token exchange, locked credential persistence and token refresh.
// No credential, submitted answer, or raw provider error enters a JSON response.
export class ProviderAccounts {
  private attempt?: LoginAttempt;
  private removing = false;
  constructor(
    private runtime: () => Promise<AccountRuntime>,
    readonly readOnly = process.env.MARGIN_AUTH_READ_ONLY === "1",
    private loginTimeoutMs = 10 * 60_000,
  ) {}

  async list(): Promise<ProviderAccountsView> {
    const runtime = await this.runtime();
    const signal = AbortSignal.timeout(10_000);
    const stored = new Set(
      (await runtime.listCredentials({ signal })).map((c) => c.providerId),
    );
    const providers = await Promise.all(
      runtime.getProviders().map(async (p): Promise<ProviderAccount> => {
        const methods: ProviderAccount["methods"] = [];
        if (p.auth.oauth)
          methods.push({
            type: "oauth",
            label:
              p.auth.oauth.loginLabel ?? `Sign in with ${p.auth.oauth.name}`,
          });
        if (p.auth.apiKey?.login)
          methods.push({
            type: "api_key",
            label: /api key/i.test(p.auth.apiKey.name ?? "API key")
              ? "Use API key"
              : `Configure ${p.auth.apiKey.name}`,
          });
        let status: Awaited<ReturnType<AccountRuntime["checkAuth"]>>;
        let statusError = false;
        try {
          status = await runtime.checkAuth(p.id, { signal });
        } catch {
          statusError = true;
        }
        return {
          id: p.id,
          name: names[p.id] ?? p.name,
          methods,
          configured: !!status,
          authType: status?.type,
          stored: stored.has(p.id),
          statusError,
        };
      }),
    );
    providers.sort((a, b) => {
      const rank = (id: string) =>
        featured.includes(id) ? featured.indexOf(id) : featured.length;
      return rank(a.id) - rank(b.id) || a.name.localeCompare(b.name);
    });
    return {
      providers,
      readOnly: this.readOnly,
      login: this.attempt ? this.snapshot(this.attempt) : undefined,
    };
  }

  private writable() {
    if (this.readOnly)
      throw new AccountError(
        "Account changes are disabled by MARGIN_AUTH_READ_ONLY. Restart Margin without it, or use pi /login in Terminal.",
      );
    if (this.removing || this.attempt?.running)
      throw new AccountError(
        "Another account operation is still running. Finish or cancel it first.",
      );
  }
  private snapshot(attempt: LoginAttempt) {
    return structuredClone(attempt.view);
  }
  private require(id: string) {
    if (this.attempt?.view.id !== id)
      throw new AccountError(
        "This sign-in is no longer available. Start again.",
      );
    return this.attempt;
  }
  get(id: string) {
    return this.snapshot(this.require(id));
  }

  start(providerId: string, method: AuthType): ProviderLogin {
    this.writable();
    const attempt: LoginAttempt = {
      view: {
        id: randomUUID(),
        providerId,
        method,
        status: "pending",
        expiresAt: Date.now() + this.loginTimeoutMs,
        events: [],
      },
      abort: new AbortController(),
      running: true,
    };
    this.attempt = attempt;
    void this.run(attempt);
    return this.snapshot(attempt);
  }
  private async run(attempt: LoginAttempt) {
    const { view, abort } = attempt;
    const timer = setTimeout(
      () => this.abort(attempt, "expired"),
      this.loginTimeoutMs,
    );
    timer.unref();
    try {
      const runtime = await this.runtime();
      abort.signal.throwIfAborted();
      const provider = runtime
        .getProviders()
        .find((p) => p.id === view.providerId);
      if (
        !provider ||
        !(view.method === "oauth"
          ? provider.auth.oauth
          : provider.auth.apiKey?.login)
      )
        throw new AccountError(
          "This provider does not expose that sign-in method through Pi.",
        );
      await runtime.login(view.providerId, view.method, {
        signal: abort.signal,
        notify: (event) => {
          if (abort.signal.aborted) return;
          const safe = safeEvent(event);
          // Keep the current event of each type, not an unbounded progress log.
          view.events = [
            ...view.events.filter((e) => e.type !== safe.type),
            safe,
          ];
        },
        prompt: (prompt) => this.prompt(attempt, prompt),
      });
      view.status = "connected";
      view.message =
        "Credentials saved in Pi. Model access is checked when you send a message.";
    } catch (error) {
      // A committed credential must not be misreported as a failed/cancelled login.
      if (
        error instanceof CredentialSynchronizationError &&
        error.operation === "login"
      ) {
        view.status = "connected";
        view.message =
          "Credentials were saved, but Pi could not refresh its local model state. Refresh models or restart Margin; do not sign in again just to retry the refresh.";
      } else {
        view.status = attempt.reason ?? "error";
        view.message =
          attempt.reason === "expired"
            ? "Sign-in expired. Start again."
            : attempt.reason === "cancelled"
              ? "Sign-in cancelled."
              : error instanceof AccountError
                ? error.message
                : "Sign-in failed. Check your account eligibility, network connection, and Pi credential-file permissions, then try again. For browser login, close any other Pi login using its callback port. You can also use pi /login in Terminal.";
      }
    } finally {
      clearTimeout(timer);
      attempt.running = false;
      attempt.answer = undefined;
      delete view.prompt;
      view.events = [];
    }
  }
  private prompt(attempt: LoginAttempt, prompt: AuthPrompt): Promise<string> {
    const signal = prompt.signal
      ? AbortSignal.any([attempt.abort.signal, prompt.signal])
      : attempt.abort.signal;
    signal.throwIfAborted();
    if (attempt.answer)
      throw new AccountError(
        "Pi requested overlapping login prompts. Cancel and try Terminal login instead.",
      );
    const { signal: _signal, ...fields } = prompt;
    const id = randomUUID();
    attempt.view.prompt = { ...fields, id };
    return new Promise<string>((resolve, reject) => {
      const cleanup = () => {
        signal.removeEventListener("abort", onAbort);
        if (attempt.view.prompt?.id === id) delete attempt.view.prompt;
        attempt.answer = undefined;
      };
      const onAbort = () => {
        cleanup();
        reject(new Error("Login prompt cancelled"));
      };
      attempt.answer = (value) => {
        cleanup();
        resolve(value);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
  }
  answer(id: string, promptId: string, value: string) {
    const attempt = this.require(id);
    const prompt = attempt.view.prompt;
    if (
      attempt.abort.signal.aborted ||
      !attempt.answer ||
      !prompt ||
      prompt.id !== promptId
    )
      throw new AccountError(
        "That login step has finished. Use the current step instead.",
      );
    if (prompt.type === "select" && !prompt.options.some((o) => o.id === value))
      throw new AccountError("Choose one of the displayed options.");
    if (
      (prompt.type === "secret" || prompt.type === "manual_code") &&
      !value.trim()
    )
      throw new AccountError("Enter a value before continuing.");
    // Pi supports shell/env expressions in stored API keys. Settings accepts
    // literal keys only; advanced expressions remain an explicit Terminal/file setup.
    if (
      prompt.type === "secret" &&
      attempt.view.method === "api_key" &&
      (value.trimStart().startsWith("!") || value.includes("$"))
    )
      throw new AccountError(
        "Enter a literal API key, not a shell command or environment expression. Configure advanced credentials through Pi instead.",
      );
    attempt.answer(value);
    return this.snapshot(attempt);
  }
  private abort(attempt: LoginAttempt, reason: "cancelled" | "expired") {
    if (!attempt.running || attempt.abort.signal.aborted) return;
    attempt.reason = reason;
    attempt.view.status = "cancelling";
    attempt.view.events = [];
    attempt.abort.abort();
  }
  cancel(id: string) {
    const attempt = this.require(id);
    this.abort(attempt, "cancelled");
    return this.snapshot(attempt);
  }
  close() {
    if (this.attempt) this.abort(this.attempt, "cancelled");
  }
  async remove(providerId: string): Promise<{ warning?: string }> {
    this.writable();
    this.removing = true;
    try {
      const runtime = await this.runtime();
      if (!runtime.getProviders().some((p) => p.id === providerId))
        throw new AccountError("Unknown provider.");
      await runtime.logout(providerId, { signal: AbortSignal.timeout(15_000) });
      return {};
    } catch (error) {
      if (
        error instanceof CredentialSynchronizationError &&
        error.operation === "logout"
      )
        return {
          warning:
            "Saved credentials were removed, but Pi could not refresh its local model state. Refresh models or restart Margin.",
        };
      if (error instanceof AccountError) throw error;
      throw new AccountError(
        "Could not remove credentials. Check Pi credential-file permissions and try again.",
      );
    } finally {
      this.removing = false;
    }
  }
}
function safeEvent(event: AuthEvent): AuthEvent {
  if (event.type === "auth_url") {
    const url = safeAuthUrl(event.url);
    if (!url) throw new AccountError("Pi supplied an unsupported sign-in URL.");
    return { type: event.type, url, instructions: event.instructions };
  }
  if (event.type === "device_code") {
    const verificationUri = safeAuthUrl(event.verificationUri);
    if (!verificationUri)
      throw new AccountError("Pi supplied an unsupported verification URL.");
    return {
      type: event.type,
      verificationUri,
      userCode: event.userCode,
      expiresInSeconds: event.expiresInSeconds,
    };
  }
  if (event.type === "info")
    return {
      type: event.type,
      message: event.message,
      links: event.links?.flatMap((link) => {
        const url = safeAuthUrl(link.url);
        return url ? [{ url, label: link.label }] : [];
      }),
    };
  return { type: "progress", message: event.message };
}
const providerId = z.string().min(1).max(200);
const idSchema = z.string().uuid();
export function installProviderAccountRoutes(
  app: Express,
  accounts: ProviderAccounts,
) {
  // Installed only behind the host's authenticated, same-origin JSON API guard.
  // Handle errors here: upstream errors can contain token-response bodies.
  const route =
    (handler: RequestHandler): RequestHandler =>
    async (req, res, next) => {
      res.setHeader("Cache-Control", "no-store");
      try {
        await handler(req, res, next);
      } catch (error) {
        res.status(400).json({
          error:
            error instanceof AccountError
              ? error.message
              : error instanceof z.ZodError
                ? "Invalid account request."
                : "Unable to read Pi accounts. Check Pi credential-file permissions and try again.",
        });
      }
    };
  app.get(
    "/api/provider-accounts",
    route(async (_req, res) => {
      res.json(await accounts.list());
    }),
  );
  app.post(
    "/api/provider-accounts/login",
    route((req, res) => {
      const input = z
        .object({ providerId, method: z.enum(["oauth", "api_key"]) })
        .strict()
        .parse(req.body);
      res.json(accounts.start(input.providerId, input.method));
    }),
  );
  app.get(
    "/api/provider-accounts/login/:id",
    route((req, res) => {
      res.json(accounts.get(idSchema.parse(req.params.id)));
    }),
  );
  app.post(
    "/api/provider-accounts/login/:id/answer",
    route((req, res) => {
      const input = z
        .object({ promptId: idSchema, value: z.string().max(16_384) })
        .strict()
        .parse(req.body);
      res.json(
        accounts.answer(
          idSchema.parse(req.params.id),
          input.promptId,
          input.value,
        ),
      );
    }),
  );
  app.delete(
    "/api/provider-accounts/login/:id",
    route((req, res) => {
      res.json(accounts.cancel(idSchema.parse(req.params.id)));
    }),
  );
  app.delete(
    "/api/provider-accounts/:providerId",
    route(async (req, res) => {
      res.json(await accounts.remove(providerId.parse(req.params.providerId)));
    }),
  );
}
