import type { AuthEvent, AuthPrompt, AuthType } from "@earendil-works/pi-ai";

type WithoutSignal<T> = T extends unknown ? Omit<T, "signal"> : never;
export type LoginPrompt = WithoutSignal<AuthPrompt> & { id: string };
export interface ProviderAccount {
  id: string;
  name: string;
  methods: { type: AuthType; label: string }[];
  configured: boolean;
  authType?: AuthType;
  stored: boolean;
  statusError?: boolean;
}
export interface ProviderLogin {
  id: string;
  providerId: string;
  method: AuthType;
  status:
    | "pending"
    | "cancelling"
    | "connected"
    | "cancelled"
    | "expired"
    | "error";
  expiresAt: number;
  events: AuthEvent[];
  prompt?: LoginPrompt;
  message?: string;
}
export interface ProviderAccountsView {
  providers: ProviderAccount[];
  readOnly: boolean;
  login?: ProviderLogin;
}
export function loginPending(login?: ProviderLogin) {
  return login?.status === "pending" || login?.status === "cancelling";
}
// Provider-controlled links are opened by the human, never executed by the host.
export function safeAuthUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}
export function providerBillingNote(id: string) {
  if (id === "anthropic")
    return "Claude Pro/Max sign-in uses separately billed extra usage in third-party tools, not included plan limits. API keys use API billing.";
  if (id === "openai-codex")
    return "Uses your eligible ChatGPT/Codex subscription. This is separate from OpenAI API billing.";
  if (id === "openai")
    return "Uses separately billed OpenAI API access, not a ChatGPT subscription. Choose ChatGPT / Codex for subscription access.";
  if (id === "xai")
    return "Subscription sign-in uses eligible SuperGrok or X accounts; access and limits depend on your plan. API keys use separate API billing.";
  if (id === "openrouter")
    return "Browser sign-in creates an API key billed from your OpenRouter credits; it is not an unlimited subscription.";
  if (id === "google")
    return "Uses Gemini API access, not a consumer Gemini subscription. API quotas and billing apply.";
  return "Provider eligibility, quotas, and billing apply. A saved credential does not verify access to every model.";
}
