# Minimal installation for a technical audience

Design note, 15 September 2026. The native first step is now implemented by install.sh and start.sh; see installation.md for current behavior. Existing installations are updated in place, preserving their paths and data. The larger [installation recommendations](installation-recommendations.md) describe a later distribution.

## Recommendation in one paragraph

**Keep the existing source checkout and `.margin-data/`. Give Pi a private directory inside it, include a pinned copy of cco with the release, and make Margin launch that exact copy.** Publish a short `INSTALL.md` for people and coding agents. Technical users provide macOS, a supported Node/npm installation, and Git. Margin already installs its Pi SDK through npm. This is a small step toward a self-contained installation with no separate global Pi or cco requirement.

## Three clarifications

### What does “global resource discovery and inherited credentials” mean?

“Global” means configuration elsewhere in the user’s account, shared by multiple applications. Two examples:

- A person has a skill in `~/.agents/skills/`. Pi can discover it automatically, even when its own configuration directory has moved into Margin. That skill may then appear in Margin’s picker.
- A person has set `OPENAI_API_KEY` in their terminal environment. Programs started from that terminal receive it. Pi may find a usable provider key even before that person signs in through Margin.

This can explain why Margin shows different skills or available providers on two computers. It does not mean those computers must have a global Pi installation.

**For this first step, private saved Pi configuration is required. Full independence from optional host configuration is later work.** Document that project/global skill discovery and environment-based provider keys can still work. Verify Margin also works without them. This keeps the first change small without claiming complete isolation.

### Is `.margin-data/` different from `Margin/data/`?

They serve the **same purpose**: storing Margin’s conversations, comments, uploads, settings, and other saved application state. `.margin-data/` is today’s name and default location. `Margin/data/` was an example name in a proposed future folder layout. The leading dot conventionally hides a folder in normal directory views; it does not make it encrypted.

**Keep `.margin-data/` for this beta. There is no need to rename it or move existing conversations.** The existing `MARGIN_DATA_DIR` setting selects a different location when needed. Pi’s private configuration can be a child directory, as shown below. Users’ selected project files remain in their original folders.

### What does bundling or extracting cco mean?

cco is software that starts another program with OS-enforced restrictions. We can include its files in Margin’s release, just as we include other dependencies.

- **Bundling:** ship a copy of the existing cco code and supporting files with Margin.
- **Extracting/adapting:** take its smaller sandbox helper, change the integration or policy, and maintain that smaller component ourselves.

**Use bundling for the first step.** Include a complete pinned source snapshot under `vendor/cco/`, preserving its license and file layout. Here, `vendor` just means third-party code included in our project. No global cco installer needs to run. The MIT license allows redistribution with the required notices. [cco license](https://github.com/nikvdp/cco/blob/master/LICENSE).

Have Margin call the absolute path `<checkout>/vendor/cco/cco`, with the native backend selected. Continue using its current controlled launch directory, worker environment, and directory grants. cco has installation-directory discovery logic, so verify it loads the adjacent bundled helper and never redirects to a global checkout. [cco launch/source-location logic](https://github.com/nikvdp/cco/blob/master/cco).

**Yes: that makes the cco code used by Margin independent of the global cco installation.** Updating or removing global cco will not replace the bundled copy. Margin releases update that copy. This does not remove macOS’s role in enforcing the sandbox or isolate every inherited environment setting.

## Smallest proposed layout

```text
margin/                         Existing source checkout
  package.json
  package-lock.json
  INSTALL.md                    Proposed short installation guide
  vendor/cco/                   Proposed pinned cco snapshot + license
  node_modules/                 Includes the pinned Pi SDK
  .margin-data/                 Existing persistent application data
    margin.sqlite
    ...                         Existing chats, uploads, workspace data, recovery
    pi/                         Proposed private Pi configuration
      auth.json
      settings.json
      ...
```

Set `PI_CODING_AGENT_DIR` to the absolute `<root data directory>/pi` path before initializing Pi. Create it on first launch and pass the same path to the gateway, every workspace worker, and the local Pi CLI used for recovery/login. External workers have their own Margin data directories; they should still share this one installation-owned Pi directory so a login works across workspaces.

Start with a fresh private login through **Settings → Provider accounts**. Keep existing global Pi credentials untouched. Existing chats remain in their present data directories; chats using a provider will need that provider connected in the private configuration. `.margin-data/` is already ignored by Git and excluded from code checkpoints; preserve it during ordinary updates.

## Implementation scope

1. **Private Pi configuration:** initialize and consistently propagate the installation’s Pi directory. Ensure normal credential refresh still works.
2. **Bundled cco:** ship one tested revision and its complete required files, point the current worker launcher to it, and select native macOS execution. Retain the existing policy for this beta and its documented limits. Removing broad default grants or extracting a smaller helper is a separate policy change.
3. **Accurate installation guide:** state supported macOS/architecture, Git, and the tested Node version; explain installation, login, restart, backup, and the two configuration paths. Node 24 LTS is the recommended line to qualify; the currently advertised Node 22.13 minimum is below Pi’s declared 22.19 requirement.

Once implemented and checked, the user-facing installation remains:

```sh
# From the downloaded/cloned Margin release:
npm ci --include=dev --ignore-scripts
npm run build
npm start
```

Verify this install-script policy on a fresh supported machine before publishing. Development dependencies remain necessary because the current server uses `tsx` at runtime. The release should include the cco files directly, so installing does not fetch a moving upstream branch or require a Git submodule command. An agent can follow `INSTALL.md`, run these commands, and guide the user through provider sign-in.

Node/Git installation remains a documented prerequisite. Automatic Node bootstrapping, a new folder structure, comprehensive host-resource isolation, Linux/Docker support, automatic updates, and browser-driven restarts are follow-ups. Terminal restart instructions remain acceptable for this explicitly technical beta.

## Minimum verification before sharing

- Install with global Pi/cco absent and no provider environment keys; sign in through Margin and obtain a reply.
- Confirm credentials are written only to the chosen private Pi directory and can refresh normally.
- Repeat with an unrelated global cco present; verify the bundled executable and bundled helper are still used.
- Run the real sandbox filesystem probe against the bundled copy, exercise a workspace worker, and check Stop and restart. Tests that use a fake cco do not establish OS enforcement.
- Confirm saved conversations survive restart and existing Git checkpoints still work. Run the relevant existing application checks for the launcher changes.

**Completion criterion:** a technical user with supported macOS, Node/npm, and Git can install Margin, connect a provider, and chat without separately installing Pi or cco. The beta has its own saved Pi configuration and preserves existing Margin storage behavior.

This document records the original design discussion. See installation.md for the implemented native installer and its current validation limits.
