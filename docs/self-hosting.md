**Margin self-hosting: findings and suggested direction**

Research date: 14 September 2026. Status: research and proposed design; no server image, installer, or remote deployment has been implemented or tested as part of this work.

**The immediate goal is one private installation per owner.** You and other people should be able to run Margin on an independent server, use it from a phone, and leave agents working when a laptop is off. Each person operates their own installation. A service with public signup, billing, and multiple unrelated users is deferred. Localhost installation remains supported.

Required experience: private access, Codex subscription authentication, persistent projects and conversations, usable mobile chat and artifact reviews, straightforward installation and upgrades. Server work uses server files and credentials; it does not automatically gain access to a sleeping laptop's folders or services.

**Recommendation: a small Linux VPS, a versioned Docker distribution, and built-in owner authentication.** Start with 4–8 GB RAM as a sizing estimate, then measure a representative workload: each active workspace runs a Node/Pi worker, and builds or browser tools add memory. Package the dependencies so the owner primarily manages Docker and configuration. Keep Cloudflare integration optional. Validate cco's Linux execution boundary before publishing the image as supported.

This recommendation favors the current persistent Node, SQLite, filesystem, and background-process architecture. It also gives other self-hosters the same deployable unit. It does not require building a multi-user service first.

**Better Auth puts authentication inside Margin.** It is a TypeScript library that the developer integrates into the app. It handles accounts, password authentication, social login, and sessions. It can use SQLite. The owner would see Margin's login screen, and the authentication data would live with that installation. Installing Margin would also install the library; the owner would not need to run a separate Better Auth server. [Introduction](https://better-auth.com/docs/introduction), [SQLite support](https://better-auth.com/docs/adapters/sqlite).

Suggested first configuration: one owner account, registration closed, password-based login, and a documented server-side recovery command. This avoids requiring email delivery infrastructure merely to get started. Google can be an optional login method; password recovery by email would require additional configuration if offered. [Password authentication](https://better-auth.com/docs/authentication/email-password).

Google login requires the operator to create a Google OAuth client, configure the installation's exact callback URL, and supply the client ID and secret. This is a one-time setup step, not zero-configuration authentication. Allow only the configured owner identity; a successful Google login must not admit arbitrary Google users. [Google configuration](https://better-auth.com/docs/authentication/google).

**Cloudflare Access puts authentication in front of Margin.** It is a hosted Cloudflare service. A request to the app first passes an access policy, such as “allow this Google account.” Cloudflare authenticates the visitor before forwarding the request. It is convenient for a private app when the owner is comfortable configuring Cloudflare. [Access for web applications](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/), [Google identity provider](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/).

Cloudflare Tunnel is a separate component: a connector on the VPS makes an outbound connection to Cloudflare, which carries requests to Margin. Tunnel supplies connectivity; Access supplies the login policy. These services do not replace the VPS that runs Pi. [Tunnel overview](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/).

| Choice                                  | What the owner sets up                                                | Best fit                                                   |
| --------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------- |
| Built-in owner login, using Better Auth | Margin owner account, public URL, HTTPS; optional Google OAuth client | Recommended portable self-hosting experience               |
| Cloudflare Access + Tunnel              | Cloudflare account, domain/tunnel, access policy, identity provider   | Optional route for owners who prefer a managed access gate |

Both routes need intentional integration with Margin's current terminal-issued browser connection token. Avoid a permanent sequence of Cloudflare login followed by a second terminal-link login. In an Access configuration, validate the asserted identity and prevent requests from bypassing the gate. Protect preview hosts and their assets as well as the main hostname. A direct HTTPS installation can use a supplied Caddy service to manage certificates. [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https).

**Codex subscription login is a separate connection from the app login.** Google or a password establishes who may use Margin. Connecting a Codex subscription authorizes Pi to use the owner's model entitlement. Neither connection supplies the other.

The installed Pi 0.85.1 dependency implements both browser and device-code Codex login, plus refresh-token handling. Margin's current Settings UI selects already-authenticated models and still directs people to `pi /login`; it does not provide that login flow itself. See [model setup](../server/models.ts), [Settings dialog](../src/SettingsDialog.tsx), and the installed dependency's `dist/auth/oauth/openai-codex.js`.

Proposed phone flow: sign into Margin → choose **Connect Codex subscription** → copy the displayed device code → open the provider's verification page → authorize → return to Margin. The server polls for completion and persists the resulting credentials. Bind that attempt to the authenticated owner and keep refresh tokens off the browser. OpenAI documents device-code login for headless Codex, subject to account/workspace settings. The Pi integration still needs an actual server-and-phone test. The official Codex instructions alone do not establish every third-party integration's support status. [OpenAI authentication](https://learn.chatgpt.com/docs/auth).

Pi's writable credential storage must survive image replacement. Do not use `MARGIN_AUTH_READ_ONLY=1` for normal unattended operation: it prevents credential refresh. Subscription limits and occasional reauthentication remain possible; do not silently switch to a separately billed API provider.

**Yes, a prebuilt Docker image is the recommended distribution format for a VPS.** A Docker image is a prepared filesystem containing the app and its runtime dependencies. The release process builds it once; owners download the image instead of assembling Node, Pi, packages, and system tools individually. Docker Compose describes the app, persistent storage, and optional HTTPS/tunnel services. [Compose for single-host deployments](https://docs.docker.com/compose/intro/features-uses/).

| Component                                                   | Where it should be installed           | Notes                                                                                                                       |
| ----------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Docker Engine and Compose plugin                            | VPS host                               | The main host prerequisites, installed once                                                                                 |
| Node.js and npm                                             | Margin image                           | Pin a tested release satisfying the current Node >=22.13 requirement                                                        |
| Margin frontend, backend, plugins, bundled skills           | Margin image                           | Build and test during release creation                                                                                      |
| Pi SDK and CLI                                              | Margin image                           | Already an npm dependency: `@earendil-works/pi-coding-agent` is pinned to 0.85.1; expose its bundled CLI for recovery/login |
| JavaScript dependencies                                     | Margin image                           | Install from the lockfile; no independent global Pi installation needed on the VPS                                          |
| cco and its Linux backend, bubblewrap                       | Proposed Margin image                  | Explicitly select and validate the Linux native backend; see the qualification below                                        |
| Bash, Git, CA certificates, curl, ripgrep, basic Unix tools | Margin image                           | Proposed baseline for shell tools, repositories, downloads, and diagnostics                                                 |
| Python, uv, compilers, browser binaries and libraries       | Appropriate image/tool layer           | Add a documented baseline or optional variants for actual workloads; they are not all core Margin requirements              |
| Caddy or cloudflared                                        | Separate Compose service when selected | Keep HTTPS/tunnel configuration outside agent-editable project files                                                        |
| Model credentials and Google client secret                  | Persistent private state/configuration | Created during setup; never baked into a published image                                                                    |

Pi is embedded through its SDK; Margin does not need a second always-running Pi daemon. Check the actual package's `bin` entry when exposing its CLI. Current launchers also use `tsx` at runtime even though it is listed under devDependencies. A production image must retain it or ship a tested compiled backend. Blindly running `npm ci --omit=dev` would omit a current runtime requirement. See [package configuration](../package.json) and [worker launcher](../server/workspace-workers.ts).

**cco is the important packaging qualification.** It wraps each workspace's worker to restrict filesystem writes. On Linux it supports bubblewrap; it can also select Docker as a backend. Installing cco in an image does not ensure that nested sandboxing works: kernel namespaces, Docker's security profile, filesystem paths, and permissions all matter. The repository currently documents native macOS as the target and the Docker fallback as unvalidated. [cco](https://github.com/nikvdp/cco), [Docker seccomp](https://docs.docker.com/engine/security/seccomp/), [current Margin execution policy](sandboxing-proposal.md).

The primary candidate to validate is:

```text
Phone/browser
  → HTTPS and owner authentication
  → Margin gateway inside the Docker container
      → cco with the Linux native backend → workspace A worker → Pi
      → cco with the Linux native backend → workspace B worker → Pi
  → authenticated preview router → the selected workspace's generated app
```

All application paths in this arrangement resolve inside the image and mounted data directories. The gateway reaches its workers internally. A separate proxy container needs a gateway listener reachable on the private Compose network; the current loopback-only listener cannot be used unchanged for that connection. Only the intended HTTPS entrypoint should be publicly reachable.

Keep the existing fail-closed behavior: if the selected cco backend cannot start, report that failure. Do not silently fall back to unrestricted workers, give the agent the host Docker socket, or advertise a privileged container as equivalent protection. Docker's own documentation describes why control of the daemon is powerful. [Docker security](https://docs.docker.com/engine/security/).

If cco-in-Docker cannot be made reliable with a suitably restricted, documented configuration, the concrete fallback is a **native Linux installer plus a system service**, bundling/installing Node, Pi, cco, and bubblewrap on the VPS. That retains the per-workspace cco launch architecture while Docker support is resolved; its effective Linux write restrictions still need validation on the supported host. An explicit mode that uses one container as the only filesystem boundary is another design option, but would change protection between an owner's workspaces; it should be evaluated and documented separately. No such policy change is made by this research.

**The installation should feel like a short setup wizard.** The following is the desired release experience, not a working installation guide for the current repository:

1. Rent a supported Linux VPS and connect through SSH. Choose a domain for the normal HTTPS browser experience.
2. Download a versioned Margin server release containing the Compose definition, configuration template, and setup helper. The helper checks the OS, architecture, Docker/Compose, disk space, ownership, and cco execution support.
3. Choose the public URL, data directory, and owner login. Built-in password login is the simplest default; Google or Cloudflare Access adds their configuration steps. Owner creation uses a terminal-controlled or one-time protected setup flow, never an unclaimed public signup page. The helper must also configure preview hostnames, DNS, TLS, and Access policies where applicable. An application certificate does not automatically cover arbitrary preview subdomains; specify a tested wildcard or individually provisioned hostname strategy.
4. Pull the prebuilt image and start the services. Run Margin as a non-root user; configure restart-on-reboot and resource limits. The helper initializes data-volume permissions without asking the owner to diagnose UID errors.
5. Open the URL on the phone, sign in, connect the Codex subscription, and create/import a server workspace. If browser provider setup is not yet implemented, the documented interim route is the bundled Pi CLI over SSH, using the same credential directory as the running app.
6. Verify a real task continues after disconnecting SSH and closing the laptop. Return from the phone and review its results.

Illustrative release commands, assuming the proposed helper and Compose bundle have been shipped:

```sh
./margin-server setup
docker compose pull
docker compose up -d
```

`margin-server` does not exist yet. The current repository also has no Dockerfile or Compose distribution. A supported release should specify its tested Linux distributions and architectures; do not promise ARM support until the image and dependencies have been checked there.

**Keep all mutable state in explicit persistent locations.** A suggested container layout is:

```text
/opt/margin/            versioned application installation
/data/margin/          app/owner/session databases, transcripts, notes, recovery data
/data/config/          private app-auth secret and deployment configuration
/data/pi/agent/        Pi auth, settings, skills, model configuration
/data/workspaces/      server project folders and generated artifacts
/data/home/            owner tool configuration and selected persistent caches
```

Existing variables can point `MARGIN_DATA_DIR` to `/data/margin` and `PI_CODING_AGENT_DIR` to `/data/pi/agent`. Persist the proposed owner accounts, app sessions, and authentication signing/encryption secret as well as Pi credentials. Include them in protected backups; Google client configuration must also survive updates. Pin the effective home directory for tool processes during installation so Git/SSH and other tool credentials resolve consistently; do not assume all tools store state under Pi's directory. Bootstrap the recovery helper into persistent storage: today's build writes it under the build-time data directory, which can be hidden by a later volume mount. See [Pi/model setup](../server/models.ts), [workspace storage](../server/workspace-data.ts), and [recovery build](../scripts/build-recovery.ts).

Project dependencies such as `node_modules`, Python environments, and installed utilities need a policy too. Project-local packages can live with their workspace. OS packages installed manually in a running container may disappear when the container is replaced; routinely needed system tools belong in a reproducible derived image. Use separate optional services for project databases or other substantial dependencies. No GPU is needed merely to call a subscription-backed remote model.

Localhost retains the current native launcher, local folder picker where supported, and existing Pi configuration. A container-based localhost install can be an additional option, with explicitly mounted projects. A server install uses a browser workspace chooser scoped to its data directory, with create, upload/import, and optional Git clone actions. Existing skills and files must be transferred intentionally.

**Updates must preserve data and respect customization.** For stock installations, release upgrades should finish/stop active work, take a consistent backup, pull the selected version, recreate services, and verify readiness. Customized installations first need a prepared and tested integrated release as described below. SQLite uses WAL, so copying only a live `.sqlite` file is insufficient. Stop all writers for an offline backup or implement a supported consistent backup procedure. Back up projects and Pi state as well as Margin's databases, and test restoration on a fresh installation. Image rollback alone may not reverse a data migration. See [SQLite setup](../server/store.ts) and [runtime recovery](runtime-recovery.md).

An immutable stock image also affects **Customize Margin**, which currently edits the app's source and bundled plugins. The current gateway unconditionally registers the application root as a workspace, and registration checks write access. A read-only `/opt/margin` therefore requires a server-mode change that separates the stock installation from a writable customization checkout. See [gateway startup](../server/gateway.ts) and [workspace access](../server/workspace-access.ts).

Preserve the native customization workflow. For server customization, provide an explicit persistent source checkout/derived-image workflow with a rebuild and rollback path. Core edits must survive image replacement. Do not silently remove customization or make changes only in a disposable container layer. This can be an advanced self-hosting option; it does not require a shared-user platform. See [customization](customization-workspace.md).

The [customization and update design](customization-updates.md) compares plugin compatibility, personal Git branches, patch series, and AI-assisted adaptation. Its recommended path tracks the original upstream base, prepares a separate candidate release, uses ordinary merging first, and offers AI help for code or behavior conflicts. A Docker image pull does not perform this integration, and source rollback must be coordinated with data-schema compatibility. Today's checkpoints are independent snapshots rather than upstream merge ancestry.

**Private previews and mobile use belong in the first supported server release.** The current [gateway](../server/gateway.ts) checks localhost hosts/origins and permits localhost frames. The [preview implementation](../server/artifact-preview.ts) creates random loopback ports and expects a local HTTP parent origin. A tunnel for port 4317 alone would leave previews broken on a phone.

Add configured public origins and a private preview router with HTTP and WebSocket forwarding. Generated HTML should retain a separate browser origin from Margin. Cover preview documents, assets, iframe entry, and standalone windows with authentication; validate cookie/bootstrap behavior on phones. The public app must not become an arbitrary URL/port proxy. Keep worker endpoints internal.

Responsive CSS already exists, including narrow-screen navigation and stacked artifact feedback. That is a starting point, not proof of touch usability. Test iOS Safari and Android Chrome: login, device-code provider connection, select a passage with touch handles, comment with the keyboard open, submit feedback, open an app preview, background the browser, and reconnect. Saved work should survive a service restart; running tool promises and generated-app processes may need recovery/restart. See [styles](../src/styles.css), [artifact styles](../src/ArtifactReview.css), and [recovery behavior](runtime-recovery.md).

**The hosting research still favors a VPS for this scope.** These are advertised prices checked on the research date, not guaranteed checkout quotes or measured Margin bills. Confirm region, availability, renewal/commitment terms, taxes, storage, and backup costs before ordering. Model subscriptions and domain registration are separate.

| Option                          | Published cost indication                                                | Assessment for a private self-hosted installation                                                                                                                                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OVH VPS                         | 4 GB / 2 vCores from $4.54/month; 8 GB / 4 vCores from $8.50/month       | Good low-cost candidate; validate chosen region and representative workload. [Pricing](https://www.ovhcloud.com/en/vps/)                                                                                                                                                                            |
| Hetzner CX23                    | €5.49/month before VAT and IPv4                                          | Good published price, but public product page marked this model unavailable when checked. [Prices](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/), [product page](https://www.hetzner.com/cloud/cost-optimized/)                                               |
| DigitalOcean Basic Droplet      | 4 GiB / 2 vCPUs at $24/month                                             | Higher-cost VPS comparison. [Pricing](https://www.digitalocean.com/pricing/droplets)                                                                                                                                                                                                                |
| Vercel Sandbox                  | Hobby allowance; Pro $20/month with $20 usage credit                     | Managed isolated execution with filesystem persistence; session lifecycle and preview integration add work. [Sandbox pricing](https://vercel.com/docs/sandbox/pricing), [Pro](https://vercel.com/docs/plans/pro-plan), [persistence](https://vercel.com/docs/sandbox/concepts/persistent-sandboxes) |
| Cloudflare Sandbox / Containers | $5/month Workers plan plus metered resources and related services        | Linux execution available; local sandbox files do not survive stop under the documented lifecycle, requiring external persistence/restore. [Pricing](https://developers.cloudflare.com/containers/platform/pricing/), [lifecycle](https://developers.cloudflare.com/sandbox/concepts/sandboxes/)    |
| Railway                         | $5/month minimum including $5 usage; RAM at $10/GB-month of actual usage | Easier managed deployment once a compatible runtime exists, but cco/container constraints still need testing. [Pricing](https://docs.railway.com/pricing)                                                                                                                                           |

Vercel now supports automatic filesystem snapshots across sandbox stop/resume. That is useful progress, but it does not preserve all live processes; background services need restart logic. Hobby sessions are limited to 45 minutes and Pro sessions to 24 hours. Plain Vercel Functions remain bounded request executions, so the current persistent Margin worker cannot simply be deployed as a function. [Sandbox persistence](https://vercel.com/docs/sandbox/concepts/persistent-sandboxes), [limits](https://vercel.com/docs/sandbox/pricing), [Function limits](https://vercel.com/docs/functions/limitations).

Illustrative arithmetic: 4 GB allocated for 720 hours costs $61.06 in Vercel memory charges at the documented default-region rate. Cloudflare's corresponding memory charge is $25.70 after its 25 GiB-hour allowance, before its $5 plan, disk, CPU, and related services. These compare memory billing only, not equivalent CPU capacity or complete invoices. Sleeping between sessions reduces these costs. For one continuously available personal environment, predictable VPS pricing and an ordinary persistent disk remain attractive. [Vercel rates](https://vercel.com/docs/sandbox/pricing), [Cloudflare rates](https://developers.cloudflare.com/containers/platform/pricing/).

**Hermes offers useful packaging patterns.** Its installer and setup/update/doctor commands make native installation approachable. Its Docker image separates the installed application from persistent state under `/opt/data`, and its web dashboard requires authentication for public binding. Borrow the dependency bundling, setup wizard, persistent data layout, supervised service, and explicit update process. Its profiles should not be treated as proof of isolation between unrelated users. [Repository](https://github.com/NousResearch/hermes-agent), [Docker setup](https://hermes-agent.nousresearch.com/docs/user-guide/docker), [dashboard](https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard).

OpenCode's `opencode web` is another useful launcher example: one command starts the browser interface, with host/port configuration and password protection for network use. A similarly simple Margin command can hide routine installation steps while keeping the resulting files and services inspectable. [OpenCode web](https://opencode.ai/docs/web/).

**Suggested implementation order:**

1. Validate the Linux runtime and cco execution policy, including the proposed non-privileged Docker layout. Resolve the packaging choice before promising a one-command server installation.
2. Add server configuration, closed owner authentication, HTTPS integration, and the private preview router.
3. Add browser Codex connection, server workspace creation/import, and persistent state initialization.
4. Publish the versioned image/Compose bundle and setup helper; support backups, upgrades, and an explicit customization path.
5. Verify the complete workflow on a fresh VPS and real phones, then publish the supported installation guide.

Release checks should demonstrate that an unauthenticated visitor cannot read chats or previews; another Google account is rejected; the intended cco write restrictions hold; a run continues after the laptop disconnects; saved work and refreshed provider credentials survive service/image replacement; a fresh-machine restore works; and touch commenting works with the phone keyboard open. These are proposed checks, not completed results.

**Evidence and limits:** findings come from current repository/dependency inspection, primary vendor documentation, calculated cost examples, and a prior independent static review of hosting and phone scenarios. This documentation pass also inspected the current Settings work, which still uses terminal-based provider login. No application code was changed for self-hosting, no images were built, no infrastructure was purchased, and no live login, Linux sandbox, restore, or real-phone test was performed. Prices and platform behavior should be rechecked when implementation begins.
