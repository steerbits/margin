import { useEffect, useRef, useState } from "react";
import {
  RefreshCw,
  ExternalLink,
  ArrowUpRight,
  CheckCircle2,
} from "lucide-react";
import {
  loginPending,
  providerBillingNote,
  providerKeyUrl,
  safeAuthUrl,
  type LoginPrompt,
  type ProviderAccountsView,
  type ProviderLogin,
} from "../shared/provider-accounts.ts";
import { api, ApiError } from "./api.ts";
import { CustomConnectionsPanel } from "./CustomConnections.tsx";
import { customProviderPrefix } from "../shared/custom-connections.ts";

export function ProviderAccountsPanel({
  onChanged,
  onBusyChange,
}: {
  onChanged: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
}) {
  const [accounts, setAccounts] = useState<ProviderAccountsView>();
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [login, setLogin] = useState<ProviderLogin>();
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState("");
  const [pollError, setPollError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [customBusy, setCustomBusy] = useState(false);
  const [customEditing, setCustomEditing] = useState(false);
  const mounted = useRef(false);
  const currentLogin = useRef(login);
  currentLogin.current = login;
  const callbacks = useRef({ onChanged, onBusyChange });
  callbacks.current = { onChanged, onBusyChange };
  const completed = useRef("");
  const loginPanel = useRef<HTMLDivElement>(null);
  const hasLoginLink =
    login?.events.some(
      (event) => event.type === "auth_url" || event.type === "device_code",
    ) ?? false;
  useEffect(() => {
    if (hasLoginLink) loginPanel.current?.scrollIntoView({ block: "nearest" });
  }, [login?.id, hasLoginLink]);
  const accountBusy = acting || loginPending(login);
  const busy = accountBusy || customBusy;
  const provider = accounts?.providers.find((p) => p.id === selected);
  const filtered =
    accounts?.providers.filter((p) =>
      `${p.name} ${p.id}`.toLowerCase().includes(query.toLowerCase()),
    ) ?? [];

  async function load(adoptLogin = false) {
    const view = await api<ProviderAccountsView>("/provider-accounts");
    view.providers = view.providers.filter(
      (p) => !p.id.startsWith(customProviderPrefix),
    );
    if (!mounted.current) return;
    setAccounts(view);
    setSelected(
      (id) =>
        id ||
        view.login?.providerId ||
        view.providers.find((p) => p.configured)?.id ||
        "",
    );
    if (adoptLogin && loginPending(view.login)) {
      currentLogin.current = view.login;
      setLogin(view.login);
      setSelected(view.login!.providerId);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void load(true)
      .catch((e) => {
        if (mounted.current) setError(e.message);
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
    return () => {
      mounted.current = false;
      const active = currentLogin.current;
      if (loginPending(active))
        void api(`/provider-accounts/login/${active!.id}`, {}, "DELETE").catch(
          () => {},
        );
    };
  }, []);
  useEffect(() => {
    callbacks.current.onBusyChange(busy);
  }, [busy]);
  const pollingId = loginPending(login) ? login!.id : undefined;
  useEffect(() => {
    setPollError("");
    if (!pollingId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await api<ProviderLogin>(
          `/provider-accounts/login/${pollingId}`,
        );
        if (stopped) return;
        currentLogin.current = next;
        setLogin(next);
        setPollError("");
      } catch (e) {
        if (stopped) return;
        if (
          (e instanceof ApiError && [400, 401, 404].includes(e.status)) ||
          Date.now() > (currentLogin.current?.expiresAt ?? 0)
        ) {
          const previous = currentLogin.current;
          if (previous) {
            const next: ProviderLogin = {
              ...previous,
              status: "error",
              events: [],
              prompt: undefined,
              message:
                e instanceof ApiError
                  ? e.message
                  : "Unable to check sign-in before it expired. Refresh accounts before trying again.",
            };
            currentLogin.current = next;
            setLogin(next);
          }
          return;
        }
        setPollError(
          `${e instanceof Error ? e.message : String(e)} Rechecking sign-in status…`,
        );
      }
      if (!stopped) timer = setTimeout(() => void poll(), 750);
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [pollingId]);
  useEffect(() => {
    if (login?.status !== "connected" || completed.current === login.id) return;
    completed.current = login.id;
    void Promise.all([load(), callbacks.current.onChanged()]).catch((e) => {
      if (mounted.current)
        setError(`Credentials saved, but model refresh failed: ${e.message}`);
    });
  }, [login?.status, login?.id]);

  async function act(action: () => Promise<void>) {
    setActing(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setActing(false);
    }
  }
  async function start(method: "oauth" | "api_key") {
    await act(async () => {
      const next = await api<ProviderLogin>("/provider-accounts/login", {
        providerId: selected,
        method,
      });
      if (!mounted.current) {
        await api(`/provider-accounts/login/${next.id}`, {}, "DELETE");
        return;
      }
      currentLogin.current = next;
      setLogin(next);
      setConfirmRemove(false);
    });
  }
  return (
    <section
      className="provider-accounts"
      aria-labelledby="provider-accounts-heading"
    >
      <div className="settings-section-heading">
        <h3 id="provider-accounts-heading">
          {customEditing ? "Connect your server" : "Choose your AI provider"}
        </h3>
        <button
          type="button"
          aria-label="Refresh provider accounts"
          disabled={loading || busy}
          onClick={() =>
            void act(async () => {
              await load(true);
              await callbacks.current.onChanged();
            })
          }
        >
          <RefreshCw size={15} />
        </button>
      </div>
      <p className="settings-description">
        Connect an account you already use, bring an API key, or add your own
        server. Connections are saved privately in Margin and work across your
        workspaces.
      </p>
      {loading && <p>Loading provider accounts…</p>}
      {accounts?.readOnly && (
        <p className="account-notice">
          Account changes are disabled by MARGIN_AUTH_READ_ONLY. Restart without
          it to connect here. Expired tokens cannot refresh in this mode.
        </p>
      )}
      {accounts && !customEditing && (
        <>
          <div className="provider-grid">
            {accounts.providers
              .filter((p) =>
                ["openai-codex", "openrouter", "anthropic", "google"].includes(
                  p.id,
                ),
              )
              .map((p) => (
                <button
                  type="button"
                  key={p.id}
                  className={
                    selected === p.id
                      ? "provider-tile selected"
                      : "provider-tile"
                  }
                  disabled={busy}
                  aria-pressed={selected === p.id}
                  onClick={() => {
                    setSelected(p.id);
                    setQuery("");
                    setLogin(undefined);
                    setError("");
                    setNotice("");
                    setConfirmRemove(false);
                  }}
                >
                  <span className="provider-tile-top">
                    <strong>{p.name}</strong>
                    {p.configured ? (
                      <CheckCircle2 size={16} />
                    ) : (
                      <ArrowUpRight size={16} />
                    )}
                  </span>
                  <span>
                    {p.configured
                      ? "Connected"
                      : p.id === "openai-codex"
                        ? "Use your ChatGPT subscription"
                        : p.id === "google"
                          ? "Connect a Gemini API key"
                          : "Sign in or use an API key"}
                  </span>
                </button>
              ))}
          </div>
          <details className="provider-browse">
            <summary>Browse all providers</summary>
            <label className="account-label">
              Find a provider
              <input
                type="search"
                value={query}
                placeholder="Search providers, e.g. Grok or Gemini"
                disabled={busy}
                onChange={(e) => {
                  const value = e.target.value;
                  setQuery(value);
                  const match = accounts.providers.find((p) =>
                    `${p.name} ${p.id}`
                      .toLowerCase()
                      .includes(value.toLowerCase()),
                  );
                  if (
                    match &&
                    !`${provider?.name} ${provider?.id}`
                      .toLowerCase()
                      .includes(value.toLowerCase())
                  )
                    setSelected(match.id);
                  setConfirmRemove(false);
                }}
              />
            </label>
            <label className="account-label">
              Provider
              <select
                aria-label="Provider"
                value={filtered.some((p) => p.id === selected) ? selected : ""}
                disabled={busy || !filtered.length}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setConfirmRemove(false);
                  setLogin(undefined);
                  setError("");
                  setNotice("");
                }}
              >
                <option value="">Choose a provider</option>
                {!filtered.length && (
                  <option value="">No matching providers</option>
                )}
                {filtered.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.configured ? " · configured" : ""}
                  </option>
                ))}
              </select>
            </label>
          </details>
          {provider && filtered.length > 0 && (
            <div className="account-card">
              <strong>{provider.name}</strong>
              <p className="account-status">
                {provider.statusError
                  ? "Could not check account status. Try refreshing."
                  : provider.configured
                    ? `Connected · ${provider.authType === "oauth" ? "provider sign-in" : "API / external credentials"}${provider.stored ? " · saved in Margin" : " · configured externally"}`
                    : "Ready to connect"}
              </p>
              <p className="settings-help">
                {providerBillingNote(provider.id)}
              </p>
              {providerKeyUrl(provider.id) && (
                <p className="settings-help">
                  <AuthLink url={providerKeyUrl(provider.id)!}>
                    Create an API key on {provider.name}
                  </AuthLink>
                </p>
              )}
              {!provider.methods.length && (
                <p className="settings-help">
                  Interactive login is unavailable for this provider. Configure
                  its environment or cloud credentials on the server, then refresh.
                </p>
              )}
              {provider.configured && (
                <p className="settings-help">
                  Connecting again replaces this provider’s saved login for
                  Margin and any terminal sessions sharing these credentials.
                  Existing conversations keep their model but subsequent
                  requests use the new credentials.
                </p>
              )}
              <div className="account-actions">
                {provider.methods.map((method) => (
                  <button
                    type="button"
                    key={method.type}
                    disabled={busy || accounts.readOnly}
                    onClick={() => void start(method.type)}
                  >
                    {method.label}
                  </button>
                ))}
                {provider.stored && (
                  <button
                    type="button"
                    disabled={busy || accounts.readOnly}
                    onClick={() => setConfirmRemove(true)}
                  >
                    Remove saved login…
                  </button>
                )}
              </div>
              {confirmRemove && (
                <div className="account-notice">
                  <p>
                    Remove saved {provider.name} credentials? This also affects
                    terminal sessions sharing these credentials and future
                    requests in existing chats. Environment or external
                    credentials may still provide access.
                  </p>
                  <div className="account-actions">
                    <button
                      type="button"
                      disabled={acting}
                      onClick={() => setConfirmRemove(false)}
                    >
                      Keep login
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          const result = await api<{ warning?: string }>(
                            `/provider-accounts/${encodeURIComponent(provider.id)}`,
                            {},
                            "DELETE",
                          );
                          setConfirmRemove(false);
                          setLogin(undefined);
                          setNotice(
                            result.warning ??
                              "Saved login removed. External credentials, if configured, remain available.",
                          );
                          await load();
                          await callbacks.current.onChanged();
                        })
                      }
                    >
                      Remove saved credentials
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
      {accounts && (
        <CustomConnectionsPanel
          readOnly={accounts.readOnly}
          disabled={accountBusy}
          onBusyChange={setCustomBusy}
          onEditingChange={setCustomEditing}
          onChanged={async () => {
            await load();
            await callbacks.current.onChanged();
          }}
        />
      )}
      <p className="connection-footnote">
        Connections save immediately. Save below applies to conversation
        defaults.
      </p>
      {login && (
        <div
          ref={loginPanel}
          className="account-login"
          aria-label="Provider sign-in"
        >
          {loginPending(login) && (
            <p>
              {login.method === "api_key"
                ? "Add credentials for "
                : "Signing in to "}
              {accounts?.providers.find((p) => p.id === login.providerId)
                ?.name ?? login.providerId}
              .{" "}
              {login.method === "api_key"
                ? "Paste your key below. Closing Settings cancels this step."
                : "Complete authorization in your browser, then return here. This attempt expires after ten minutes."}
            </p>
          )}
          {login.events.map((event) => (
            <div key={event.type}>
              {event.type === "auth_url" ? (
                <>
                  <AuthLink url={event.url}>Open sign-in page</AuthLink>
                  {event.instructions && <p>{event.instructions}</p>}
                </>
              ) : event.type === "device_code" ? (
                <>
                  <p>Enter this code on the provider’s verification page:</p>
                  <code className="device-code">{event.userCode}</code>
                  <AuthLink url={event.verificationUri}>
                    Open verification page
                  </AuthLink>
                  <p>
                    After authorizing, return here. Margin checks automatically.
                  </p>
                </>
              ) : (
                <>
                  <p>{event.message}</p>
                  {event.type === "info" &&
                    event.links?.map((link) => (
                      <AuthLink key={link.url} url={link.url}>
                        {link.label ?? "Provider details"}
                      </AuthLink>
                    ))}
                </>
              )}
            </div>
          ))}
          {login.prompt && login.status === "pending" && (
            <LoginStep
              key={login.prompt.id}
              prompt={login.prompt}
              submitLabel={
                login.method === "api_key" && login.prompt.type === "secret"
                  ? "Save API key"
                  : undefined
              }
              disabled={acting}
              onAnswer={(value) =>
                act(async () => {
                  const next = await api<ProviderLogin>(
                    `/provider-accounts/login/${login.id}/answer`,
                    { promptId: login.prompt!.id, value },
                  );
                  currentLogin.current = next;
                  setLogin(next);
                })
              }
            />
          )}
          {login.message && (
            <p role={login.status === "error" ? "alert" : "status"}>
              {login.message}
            </p>
          )}
          {loginPending(login) && (
            <button
              type="button"
              disabled={acting || login.status === "cancelling"}
              onClick={() =>
                void act(async () => {
                  const next = await api<ProviderLogin>(
                    `/provider-accounts/login/${login.id}`,
                    {},
                    "DELETE",
                  );
                  currentLogin.current = next;
                  setLogin(next);
                })
              }
            >
              {login.status === "cancelling"
                ? "Cancelling…"
                : login.method === "api_key"
                  ? "Cancel key entry"
                  : "Cancel sign-in"}
            </button>
          )}
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {pollError && (
        <p className="settings-error" role="alert">
          {pollError}
        </p>
      )}
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
function AuthLink({
  url,
  children,
}: {
  url: string;
  children: React.ReactNode;
}) {
  const safe = safeAuthUrl(url);
  return safe ? (
    <a
      className="account-link"
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children} <ExternalLink size={13} />
    </a>
  ) : (
    <p>Unsupported sign-in link.</p>
  );
}
function LoginStep({
  prompt,
  submitLabel,
  disabled,
  onAnswer,
}: {
  prompt: LoginPrompt;
  submitLabel?: string;
  disabled: boolean;
  onAnswer: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState(
    prompt.type === "select" ? (prompt.options[0]?.id ?? "") : "",
  );
  return (
    <form
      className="account-prompt"
      onSubmit={(e) => {
        e.preventDefault();
        if (disabled) return;
        const answer = value;
        if (prompt.type !== "select") setValue("");
        void onAnswer(answer);
      }}
    >
      <label className="account-label">
        {prompt.message}
        {prompt.type === "select" ? (
          <select
            aria-label={prompt.message}
            autoFocus
            value={value}
            disabled={disabled}
            onChange={(e) => setValue(e.target.value)}
          >
            {prompt.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
                {o.description ? ` — ${o.description}` : ""}
              </option>
            ))}
          </select>
        ) : (
          <input
            autoFocus
            type={prompt.type === "text" ? "text" : "password"}
            value={value}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            placeholder={prompt.placeholder}
            maxLength={16384}
            required={prompt.type !== "text"}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
      </label>
      <button type="submit" disabled={disabled}>
        {prompt.type === "manual_code"
          ? "Submit code / redirect URL"
          : (submitLabel ?? "Continue")}
      </button>
    </form>
  );
}
