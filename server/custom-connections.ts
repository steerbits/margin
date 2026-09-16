import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { getAgentDir, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
  customApiFormats,
  customProviderPrefix,
  noAuthPlaceholder,
  type CustomConnectionInput,
  type CustomConnectionView,
  type ConnectionDiscovery,
} from "../shared/custom-connections.ts";
import { installCustomModelSupport } from "./custom-model-runtime.ts";

class ConnectionError extends Error {}
const literal = z
  .string()
  .max(16384)
  .refine(
    (value) => !value.trimStart().startsWith("!") && !value.includes("$"),
    "Use literal values, not shell commands or environment expressions.",
  );
const inputSchema = z
  .object({
    id: z
      .string()
      .regex(/^margin-custom-[a-f0-9-]{36}$/)
      .optional(),
    name: z.string().trim().max(100).optional(),
    api: z.enum(
      customApiFormats.map((format) => format.id) as [
        "openai-completions",
        "openai-responses",
        "anthropic-messages",
        "google-generative-ai",
      ],
    ),
    baseUrl: z.string().trim().max(2048),
    authentication: z.enum(["api_key", "none"]),
    apiKey: literal.optional(),
    modelId: z.string().trim().max(250),
    contextWindow: z.number().int().min(512).max(10_000_000).optional(),
    maxTokens: z.number().int().min(32).max(1_000_000).optional(),
    headers: z
      .record(
        z.string().regex(/^[A-Za-z0-9-]+$/),
        literal.refine((value) => !/[\r\n]/.test(value)),
      )
      .optional(),
    supportsDeveloperRole: z.boolean().optional(),
    supportsReasoningEffort: z.boolean().optional(),
    reasoning: z.boolean().optional(),
  })
  .strict();
type StoredProvider = {
  name: string;
  api: CustomConnectionInput["api"];
  baseUrl: string;
  apiKey: string;
  headers?: Record<string, string>;
  compat?: Record<string, boolean>;
  models: {
    id: string;
    name: string;
    contextWindow: number;
    maxTokens: number;
    reasoning: boolean;
  }[];
  margin: {
    version: 1;
    authentication: "none" | "api_key";
    contextSource: CustomConnectionView["contextSource"];
  };
};
type Config = {
  providers: Record<string, StoredProvider>;
  [key: string]: unknown;
};
function normalizedUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConnectionError(
      "Enter a complete server URL, including https:// or http://.",
    );
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new ConnectionError(
      "Use an HTTP or HTTPS base URL without a password, query, or fragment.",
    );
  return url.href.replace(/\/+$/, "");
}
function safeView(id: string, p: StoredProvider): CustomConnectionView {
  return {
    id,
    name: p.name,
    api: p.api,
    baseUrl: p.baseUrl,
    authentication: p.margin.authentication,
    modelId: p.models[0].id,
    contextWindow: p.models[0].contextWindow,
    maxTokens: p.models[0].maxTokens,
    contextSource: p.margin.contextSource,
    hasHeaders: !!Object.keys(p.headers ?? {}).length,
    supportsDeveloperRole: p.compat?.supportsDeveloperRole ?? false,
    supportsReasoningEffort: p.compat?.supportsReasoningEffort ?? false,
    reasoning: p.models[0].reasoning,
  };
}
function headersFor(input: CustomConnectionInput): Record<string, string> {
  const headers = { ...input.headers };
  if (input.authentication === "api_key") {
    if (input.api === "anthropic-messages")
      headers["x-api-key"] = input.apiKey!;
    else if (input.api === "google-generative-ai")
      headers["x-goog-api-key"] = input.apiKey!;
    else headers.Authorization = `Bearer ${input.apiKey}`;
  }
  if (input.api === "anthropic-messages")
    headers["anthropic-version"] = "2023-06-01";
  return headers;
}
export class CustomConnections {
  private writing: Promise<unknown> = Promise.resolve();
  constructor(
    readonly agentDir = getAgentDir(),
    readonly readOnly = process.env.MARGIN_AUTH_READ_ONLY === "1",
    private fetcher: typeof fetch = fetch,
  ) {}
  private writable() {
    if (this.readOnly)
      throw new ConnectionError(
        "Connection changes are disabled on this Margin installation.",
      );
  }
  private async read(): Promise<Config> {
    try {
      // Match Pi's support for a BOM, line comments and trailing commas.
      const source = (
        await readFile(join(this.agentDir, "models.json"), "utf8")
      )
        .replace(/^\uFEFF/, "")
        .replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*/g, (value) =>
          value.startsWith('"') ? value : "",
        )
        .replace(
          /"(?:\\.|[^"\\])*"|,(\s*[}\]])/g,
          (value, tail) => tail ?? value,
        );
      const parsed = JSON.parse(source);
      if (
        !parsed ||
        typeof parsed.providers !== "object" ||
        Array.isArray(parsed.providers) ||
        !parsed.providers
      )
        throw new Error("Invalid config");
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { providers: {} };
      throw new ConnectionError(
        "The existing model configuration could not be read. Correct it before changing connections.",
      );
    }
  }
  private async mutate(change: (config: Config) => void, signal?: AbortSignal) {
    const result = this.writing
      .catch(() => {})
      .then(async () => {
        const config = await this.read();
        signal?.throwIfAborted();
        change(config);
        await mkdir(this.agentDir, { recursive: true, mode: 0o700 });
        const temporary = join(this.agentDir, `models.${randomUUID()}.tmp`);
        try {
          await writeFile(temporary, JSON.stringify(config, null, 2) + "\n", {
            flag: "wx",
            mode: 0o600,
          });
          signal?.throwIfAborted();
          await rename(temporary, join(this.agentDir, "models.json"));
        } finally {
          await rm(temporary, { force: true });
        }
      });
    this.writing = result;
    return result;
  }
  async list() {
    const config = await this.read();
    return {
      readOnly: this.readOnly,
      connections: Object.entries(config.providers)
        .filter(
          ([id, p]) =>
            id.startsWith(customProviderPrefix) && p.margin?.version === 1,
        )
        .map(([id, p]) => safeView(id, p)),
    };
  }
  private async input(value: unknown) {
    const input: CustomConnectionInput = inputSchema.parse(value);
    input.baseUrl = normalizedUrl(input.baseUrl);
    if (Object.keys(input.headers ?? {}).length > 30)
      throw new ConnectionError("Use at most 30 custom headers.");
    if (input.id) {
      const existing = (await this.read()).providers[input.id];
      if (!existing?.margin)
        throw new ConnectionError(
          "This connection no longer exists. Refresh connections.",
        );
      if (input.authentication === "api_key" && !input.apiKey) {
        if (existing.margin.authentication !== "api_key")
          throw new ConnectionError(
            "Enter an API key when changing from No authentication.",
          );
        if (existing.baseUrl !== input.baseUrl || existing.api !== input.api)
          throw new ConnectionError(
            "Enter the API key again when changing the server or API format.",
          );
        input.apiKey = existing.apiKey;
      }
      // Omitting headers preserves them; {} explicitly clears them.
      if (input.headers === undefined && existing.baseUrl === input.baseUrl)
        input.headers = existing.headers;
    }
    if (input.authentication === "api_key" && !input.apiKey?.trim())
      throw new ConnectionError(
        "Enter an API key, or explicitly choose No authentication.",
      );
    if (input.authentication === "none") delete input.apiKey;
    if (input.api === "google-generative-ai" && input.authentication === "none")
      throw new ConnectionError(
        "Google's API format requires a key in the bundled runtime. Use an API key, or your server's OpenAI-compatible endpoint for a connection without authentication.",
      );
    return input;
  }
  private async json(
    url: string,
    input: CustomConnectionInput,
    signal: AbortSignal,
  ) {
    const response = await this.fetcher(url, {
      headers: headersFor(input),
      signal,
      redirect: "error",
    });
    if ([401, 403].includes(response.status))
      throw new ConnectionError(
        "The server rejected these credentials. Check the authentication method and API key.",
      );
    if (!response.ok)
      throw new ConnectionError(
        "Model discovery is unavailable. Enter a model ID supplied by your server.",
      );
    const text = await response.text();
    if (text.length > 4_000_000)
      throw new ConnectionError(
        "The model list is too large. Enter a model ID manually.",
      );
    return JSON.parse(text);
  }
  async discover(
    value: unknown,
    signal = AbortSignal.timeout(12_000),
  ): Promise<ConnectionDiscovery> {
    this.writable();
    const input = await this.input(value);
    try {
      const data = await this.json(`${input.baseUrl}/models`, input, signal);
      const raw =
        input.api === "google-generative-ai" ? data.models : data.data;
      const models = (Array.isArray(raw) ? raw : [])
        .slice(0, 1000)
        .flatMap((m: any) => {
          const id =
            m.id ??
            (typeof m.name === "string"
              ? m.name.replace(/^models\//, "")
              : undefined);
          if (typeof id !== "string" || !id || id.length > 250) return [];
          const context =
            m.context_length ?? m.contextWindow ?? m.inputTokenLimit;
          return [
            {
              id,
              name: String(m.displayName ?? m.name ?? id).slice(0, 250),
              ...(Number.isInteger(context) &&
              context >= 512 &&
              context <= 10_000_000
                ? { contextWindow: context }
                : {}),
            },
          ];
        });
      return {
        models,
        ...(!models.length
          ? {
              message:
                "No models were listed. You can still enter a model ID manually.",
            }
          : {}),
      };
    } catch (error) {
      if (
        error instanceof ConnectionError &&
        error.message.includes("credentials")
      )
        throw error;
      if (signal.aborted)
        throw new ConnectionError(
          "Model discovery timed out or was cancelled. Check the URL, or enter a model ID manually.",
        );
      return {
        models: [],
        message:
          "This server did not provide a model list. Check the URL or enter a model ID manually.",
      };
    }
  }
  private async context(
    input: CustomConnectionInput,
    signal: AbortSignal,
  ): Promise<{ size: number; source: CustomConnectionView["contextSource"] }> {
    if (input.contextWindow)
      return { size: input.contextWindow, source: "manual" };
    try {
      const data = await this.json(`${input.baseUrl}/models`, input, signal);
      const models =
        input.api === "google-generative-ai" ? data.models : data.data;
      const model = models?.find(
        (m: any) =>
          (m.id ?? m.name?.replace(/^models\//, "")) === input.modelId,
      );
      // llama.cpp's training maximum isn't its active server limit.
      if (model?.owned_by === "llamacpp") {
        const endpoint = new URL(input.baseUrl);
        endpoint.pathname =
          endpoint.pathname.replace(/\/v1\/?$/, "") + "/props";
        endpoint.searchParams.set("model", input.modelId);
        endpoint.searchParams.set("autoload", "false");
        const props = await this.json(endpoint.href, input, signal);
        const size = props.default_generation_settings?.n_ctx;
        if (Number.isInteger(size) && size >= 512 && size <= 10_000_000)
          return { size, source: "server" };
      } else {
        const size =
          model?.context_length ??
          model?.contextWindow ??
          model?.inputTokenLimit;
        if (Number.isInteger(size) && size >= 512 && size <= 10_000_000)
          return { size, source: "server" };
      }
    } catch {
      /* Optional metadata; inference is still tested below. */
    }
    return { size: 16384, source: "provisional" };
  }
  async save(value: unknown, signal = AbortSignal.timeout(60_000)) {
    this.writable();
    const input = await this.input(value);
    if (!input.modelId)
      throw new ConnectionError("Choose a model or enter its model ID.");
    const context = await this.context(
      input,
      AbortSignal.any([signal, AbortSignal.timeout(8000)]),
    );
    signal.throwIfAborted();
    const id = input.id ?? `${customProviderPrefix}${randomUUID()}`;
    const name = input.name?.trim() || new URL(input.baseUrl).hostname;
    if (input.maxTokens && input.maxTokens >= context.size)
      throw new ConnectionError(
        "Maximum reply tokens must be smaller than the server's context size.",
      );
    const maxTokens =
      input.maxTokens ??
      Math.min(2048, Math.max(32, Math.floor(context.size / 4)));
    const provider: StoredProvider = {
      name,
      api: input.api,
      baseUrl: input.baseUrl,
      apiKey:
        input.authentication === "none" ? noAuthPlaceholder : input.apiKey!,
      headers: input.headers,
      compat: {
        supportsDeveloperRole: input.supportsDeveloperRole ?? false,
        supportsReasoningEffort: input.supportsReasoningEffort ?? false,
      },
      models: [
        {
          id: input.modelId,
          name: input.modelId,
          contextWindow: context.size,
          maxTokens,
          reasoning: input.reasoning ?? false,
        },
      ],
      margin: {
        version: 1,
        authentication: input.authentication,
        contextSource: context.source,
      },
    };
    const dir = await mkdtemp(join(tmpdir(), "margin-connection-test-"));
    try {
      await writeFile(
        join(dir, "models.json"),
        JSON.stringify({ providers: { [id]: provider } }),
        { mode: 0o600 },
      );
      const runtime = installCustomModelSupport(
        await ModelRuntime.create({
          credentials: new InMemoryCredentialStore(),
          modelsPath: join(dir, "models.json"),
          modelsStorePath: join(dir, "catalog.json"),
          allowModelNetwork: false,
          signal,
        }),
      );
      const model = runtime.getModel(id, input.modelId);
      if (!model || runtime.getError())
        throw new ConnectionError(
          "This model configuration could not be loaded.",
        );
      const result = await runtime
        .streamSimple(
          model,
          {
            messages: [
              {
                role: "user",
                content: "Reply with the single word OK.",
                timestamp: Date.now(),
              },
            ],
          },
          {
            maxTokens: 64,
            signal,
            fetch: this.fetcher,
            timeoutMs: 45_000,
            maxRetries: 0,
          },
        )
        .result();
      const text = result.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("")
        .trim();
      if (
        result.stopReason === "error" ||
        result.stopReason === "aborted" ||
        !text
      ) {
        const message = result.errorMessage ?? "";
        if (/401|403|unauthoriz|authentication|api.?key/i.test(message))
          throw new ConnectionError(
            "The server rejected these credentials. Check the API key and authentication method.",
          );
        if (/404|model.*not.*found|unknown model/i.test(message))
          throw new ConnectionError(
            "The server could not find this model or API route. Check the model ID, base URL, and API format.",
          );
        if (/context|token.*limit|too.*long/i.test(message))
          throw new ConnectionError(
            "The server's context limit is smaller than expected. Set its actual context size under Advanced.",
          );
        throw new ConnectionError(
          "The model did not return a usable reply. Check the server, API format, and model ID. Nothing was saved.",
        );
      }
      signal.throwIfAborted();
      await this.mutate((config) => {
        if (input.id && !config.providers[id]?.margin)
          throw new ConnectionError(
            "This connection was removed while testing. Add it again.",
          );
        config.providers[id] = provider;
      }, signal);
      return {
        connection: safeView(id, provider),
        message:
          context.source === "provisional"
            ? "Reply received and connection saved. Context capacity was not reported; a provisional budget is in use. You can override it under Advanced."
            : "Reply received and connection saved. Choose this model below to use it for new conversations.",
      };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  async rename(id: string, name: string) {
    this.writable();
    const label = z.string().trim().min(1).max(100).parse(name);
    await this.mutate((config) => {
      if (!id.startsWith(customProviderPrefix) || !config.providers[id]?.margin)
        throw new ConnectionError("Connection not found.");
      config.providers[id].name = label;
    });
  }
  async remove(id: string) {
    this.writable();
    await this.mutate((config) => {
      if (!id.startsWith(customProviderPrefix) || !config.providers[id]?.margin)
        throw new ConnectionError("Connection not found.");
      delete config.providers[id];
    });
  }
}
export function installCustomConnectionRoutes(
  app: Express,
  connections = new CustomConnections(),
) {
  const route =
    (handler: RequestHandler): RequestHandler =>
    async (req, res, next) => {
      res.setHeader("Cache-Control", "no-store");
      try {
        await handler(req, res, next);
      } catch (error) {
        res.status(400).json({
          error:
            error instanceof ConnectionError
              ? error.message
              : error instanceof z.ZodError
                ? "Check the connection fields. URLs, keys, and headers must contain literal values."
                : "The connection request failed or was cancelled. Check the server and try again.",
        });
      }
    };
  app.get(
    "/api/custom-connections",
    route(async (_req, res) => {
      res.json(await connections.list());
    }),
  );
  for (const action of ["discover", "save"] as const) {
    app.post(
      `/api/custom-connections/${action}`,
      route(async (req, res) => {
        const controller = new AbortController();
        const close = () => {
          if (!res.writableEnded) controller.abort();
        };
        res.on("close", close);
        try {
          res.json(
            await connections[action](
              req.body,
              AbortSignal.any([
                controller.signal,
                AbortSignal.timeout(action === "save" ? 60_000 : 12_000),
              ]),
            ),
          );
        } finally {
          res.off("close", close);
        }
      }),
    );
  }
  app.patch(
    "/api/custom-connections/:id",
    route(async (req, res) => {
      await connections.rename(
        String(req.params.id),
        z.object({ name: z.string() }).strict().parse(req.body).name,
      );
      res.json({});
    }),
  );
  app.delete(
    "/api/custom-connections/:id",
    route(async (req, res) => {
      await connections.remove(String(req.params.id));
      res.json({});
    }),
  );
}
